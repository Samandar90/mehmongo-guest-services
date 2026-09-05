#!/usr/bin/env node
/**
 * Manages MehmonGo super administrators.
 *
 *   node scripts/create-admin.mjs --check                    # connection and permissions only
 *   node scripts/create-admin.mjs --list                     # who can sign in today
 *   node scripts/create-admin.mjs owner@example.com          # create, password typed by you
 *   node scripts/create-admin.mjs --remove old@example.com   # delete one administrator
 *
 * The password is read from your terminal with the echo turned off. It is sent
 * only to your own Supabase project and is never printed, stored in a file or
 * written to the repository.
 *
 * Target project: SUPABASE_URL plus SUPABASE_SECRET_KEY (or
 * SUPABASE_SERVICE_ROLE_KEY) when they are set, otherwise the local stack this
 * repository runs with `supabase start`.
 */
import { exec } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const run = promisify(exec);
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const listOnly = args.includes('--list');
const removing = args.includes('--remove');
const email = args.find((argument) => argument.includes('@'));

async function localCredentials() {
  // Fixed command, no interpolation: exec avoids the Node shell-arguments deprecation.
  const { stdout } = await run('npx supabase status -o json', { maxBuffer: 1024 * 1024 });
  const json = stdout.slice(stdout.indexOf('{'));
  const status = JSON.parse(json);
  return { url: status.API_URL, key: status.SERVICE_ROLE_KEY };
}

async function credentials() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) return { url, key, where: url };
  const local = await localCredentials();
  if (!local.url || !local.key) throw new Error('No Supabase project found. Start the local stack or set SUPABASE_URL and SUPABASE_SECRET_KEY.');
  return { ...local, where: `${local.url} (local stack)` };
}

const ENTER = [13, 10];
const CTRL_C = 3;
const BACKSPACE = [127, 8];

/**
 * Reads a password from the terminal without echoing it.
 *
 * On a real terminal the input is read in raw mode, so the characters never
 * reach the screen at all. Without a terminal (a pipe, CI) it falls back to a
 * plain line read, because there is nothing to hide the input from.
 */
function askHidden(question) {
  return new Promise((resolve) => {
    const input = process.stdin;
    process.stdout.write(question);

    if (!input.isTTY) {
      const rl = createInterface({ input, terminal: false });
      rl.once('line', (line) => {
        rl.close();
        console.log('');
        resolve(line);
      });
      return;
    }

    let value = '';
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.resume();

    const finish = (answer, code) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      console.log('');
      if (code !== undefined) process.exitCode = code;
      resolve(answer);
    };

    const onData = (chunk) => {
      for (const char of chunk) {
        const code = char.charCodeAt(0);
        if (ENTER.includes(code)) return finish(value);
        if (code === CTRL_C) return finish('', 130);
        if (BACKSPACE.includes(code)) {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };

    input.on('data', onData);
  });
}

/** Reads a visible answer, for questions that are not secret. */
function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Pairs the admin_users rows with their Auth email, which lives in a schema
 * the anon and service clients cannot join against.
 */
async function listAdmins(supabase) {
  const { data: rows, error } = await supabase.from('admin_users').select('user_id, role, active');
  if (error) throw new Error(`Cannot read admin_users: ${error.message}`);
  const { data: page, error: usersError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (usersError) throw new Error(`Cannot read the accounts: ${usersError.message}`);
  const emails = new Map(page.users.map((user) => [user.id, user.email]));
  return rows.map((row) => ({ ...row, email: emails.get(row.user_id) ?? '(account deleted)' }));
}

async function main() {
  const { url, key, where } = await credentials();
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  console.log(`Project: ${where}`);

  const { error: readError } = await supabase.from('admin_users').select('user_id').limit(1);
  if (readError) {
    console.error(`Cannot read admin_users: ${readError.message}`);
    return 2;
  }
  console.log('Connection and permissions: ok');

  if (checkOnly) {
    const { count } = await supabase.from('admin_users').select('user_id', { count: 'exact', head: true }).eq('active', true);
    console.log(`Active administrators today: ${count ?? 0}`);
    return 0;
  }

  if (listOnly) {
    const admins = await listAdmins(supabase);
    if (admins.length === 0) console.log('No administrators yet.');
    for (const admin of admins) {
      console.log(`  ${admin.email}  ·  ${admin.role}  ·  ${admin.active ? 'active' : 'disabled'}`);
    }
    return 0;
  }

  if (!email) {
    console.error('Pass the administrator email, for example: node scripts/create-admin.mjs owner@example.com');
    return 1;
  }

  if (removing) {
    const admins = await listAdmins(supabase);
    const target = admins.find((admin) => admin.email === email);
    if (!target) {
      console.error(`${email} is not an administrator here. Run --list to see who is.`);
      return 1;
    }
    if (admins.filter((admin) => admin.active).length === 1 && target.active) {
      console.error('This is the only active administrator. Create the replacement first, then remove this one.');
      return 1;
    }

    const answer = await ask(`Delete the administrator ${email} and their sign-in? [y/N] `);
    if (answer.toLowerCase() !== 'y') {
      console.log('Nothing was deleted.');
      return 0;
    }

    const { error: revokeError } = await supabase.from('admin_users').delete().eq('user_id', target.user_id);
    if (revokeError) {
      console.error(`Could not revoke the role: ${revokeError.message}`);
      return 5;
    }
    const { error: deleteError } = await supabase.auth.admin.deleteUser(target.user_id);
    if (deleteError) {
      console.error(`Role revoked, but the account itself remains: ${deleteError.message}`);
      return 6;
    }
    console.log(`Removed: ${email}`);
    return 0;
  }

  const password = await askHidden(`Password for ${email} (at least 12 characters, not shown): `);
  if (password.length < 12) {
    console.error('Password too short. Nothing was created.');
    return 1;
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError) {
    console.error(`Could not create the account: ${createError.message}`);
    return 3;
  }

  const { error: roleError } = await supabase
    .from('admin_users')
    .upsert({ user_id: created.user.id, role: 'super_admin', active: true }, { onConflict: 'user_id' });

  if (roleError) {
    console.error(`Account created but the super admin role was not granted: ${roleError.message}`);
    return 4;
  }

  console.log(`Super administrator ready: ${email}`);
  console.log('Sign in at /admin/login with the password you just typed.');
  return 0;
}

// Set the exit code instead of calling process.exit, so pending handles close cleanly.
process.exitCode = await main();
