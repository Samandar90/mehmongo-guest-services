#!/usr/bin/env node
/**
 * Creates a MehmonGo super administrator.
 *
 *   node scripts/create-admin.mjs --check            # connection and permissions only
 *   node scripts/create-admin.mjs owner@example.com  # create, password typed by you
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

/** Reads a line without echoing it back to the terminal. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (char) => {
      if (['\n', '\r', ''].includes(String(char))) process.stdin.removeListener('data', onData);
      else process.stdout.write('[2K[200D' + question);
    };
    process.stdout.write(question);
    process.stdin.on('data', onData);
    rl.question('', (answer) => {
      process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
  });
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

  if (!email) {
    console.error('Pass the administrator email, for example: node scripts/create-admin.mjs owner@example.com');
    return 1;
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
