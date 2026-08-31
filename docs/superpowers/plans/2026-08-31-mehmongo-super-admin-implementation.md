# MehmonGo Super Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an owner-only super-admin interface for authentication, hotel and room management, dashboard metrics, request filtering, and Telegram retry.

**Architecture:** Supabase Auth owns sessions; browser data access uses the publishable key and RLS. Focused repository modules expose typed hotel, room, metric, and request operations to client-side admin screens; no service key enters the app bundle.

**Tech Stack:** React 19, Vinext, TypeScript 5.9, Vitest 4, Testing Library, Supabase Auth/Postgres/RLS, `@supabase/supabase-js` 2.112.4.

**Spec:** `docs/superpowers/specs/2026-08-31-mehmongo-request-admin-design.md`

## Global Constraints

- Execute after `2026-08-31-mehmongo-request-intake-implementation.md` Tasks 1–7.
- Public registration does not exist.
- Only active `admin_users.role = 'super_admin'` accounts may read or mutate admin data.
- Guests and anonymous users must receive no direct table access.
- Admin UI copy may be Russian; guest UI remains English.
- Room labels accept arbitrary non-empty values up to 40 characters.
- Room creation supports one label or a newline-separated list; Excel import is out of scope.
- Hotel percentage is stored as integer basis points.
- Every mutation has a visible pending state, success confirmation, and actionable error.
- Pin any new dependency and commit `package-lock.json`.

---

## File Structure

- `lib/admin/auth.ts` — sign-in, sign-out, session, and super-admin profile checks.
- `lib/admin/hotels.ts` — hotel queries and mutations.
- `lib/admin/rooms.ts` — room parsing, queries, creation, and activation.
- `lib/admin/requests.ts` — metrics, request filters, delivery state, and retry call.
- `components/admin/admin-shell.tsx` — authenticated navigation and session gate.
- `components/admin/login-form.tsx` — email/password login.
- `components/admin/dashboard-cards.tsx` — counts for hotels, rooms, and new requests.
- `components/admin/hotel-form.tsx` — create/edit hotel fields.
- `components/admin/hotel-list.tsx` — hotel table and activation state.
- `components/admin/room-editor.tsx` — single and multiline room creation.
- `components/admin/request-table.tsx` — filters and results.
- `app/admin/layout.tsx` — admin route shell.
- `app/admin/login/page.tsx` — login route.
- `app/admin/page.tsx` — dashboard route.
- `app/admin/hotels/page.tsx` — hotel list/create route.
- `app/admin/hotels/[id]/page.tsx` — hotel detail and rooms route.
- `app/admin/requests/page.tsx` — request operations route.

---

### Task 1: Implement owner authentication and route protection

**Files:**
- Create: `lib/admin/auth.ts`
- Test: `lib/admin/auth.test.ts`
- Create: `components/admin/admin-shell.tsx`
- Test: `components/admin/admin-shell.test.tsx`
- Create: `components/admin/login-form.tsx`
- Test: `components/admin/login-form.test.tsx`
- Create: `app/admin/layout.tsx`
- Create: `app/admin/login/page.tsx`

**Interfaces:**
- Produces: `signInAdmin(email: string, password: string): Promise<void>`.
- Produces: `signOutAdmin(): Promise<void>`.
- Produces: `getAdminIdentity(): Promise<{ userId: string; role: 'super_admin' } | null>`.
- `AdminShell` renders children only after a confirmed active super-admin profile.

- [ ] **Step 1: Write failing auth tests**

```ts
it('rejects an authenticated user without an active admin profile', async () => {
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  supabase.from.mockReturnValue(queryReturning(null));
  await expect(getAdminIdentity(supabase)).resolves.toBeNull();
});

it('returns active super-admin identity', async () => {
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  supabase.from.mockReturnValue(queryReturning({ user_id: 'user-1', role: 'super_admin', active: true }));
  await expect(getAdminIdentity(supabase)).resolves.toEqual({ userId: 'user-1', role: 'super_admin' });
});
```

- [ ] **Step 2: Confirm RED**

Run: `npm test -- --run lib/admin/auth.test.ts`
Expected: FAIL because the auth module is absent.

- [ ] **Step 3: Implement auth without trusting local session metadata**

```ts
export async function getAdminIdentity(client = getSupabaseBrowserClient()) {
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  const { data } = await client.from('admin_users').select('user_id, role, active').eq('user_id', user.id).eq('active', true).maybeSingle();
  return data?.role === 'super_admin' ? { userId: data.user_id, role: 'super_admin' as const } : null;
}
```

`signInAdmin` uses `signInWithPassword`; generic Russian error copy must not reveal whether an email exists.

- [ ] **Step 4: Write failing shell and login tests**

```ts
it('redirects anonymous users to admin login', async () => {
  const router = renderAdminShell({ identity: null });
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/admin/login'));
  expect(screen.queryByText('Отели')).not.toBeInTheDocument();
});

it('renders navigation for a super admin', async () => {
  renderAdminShell({ identity: { userId: 'user-1', role: 'super_admin' } });
  expect(await screen.findByRole('link', { name: 'Отели' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Заявки' })).toBeInTheDocument();
});

it('submits email and password then redirects', async () => {
  const signIn = vi.fn().mockResolvedValue(undefined);
  const router = renderLoginForm({ signIn });
  await userEvent.type(screen.getByLabelText('Email'), 'owner@example.com');
  await userEvent.type(screen.getByLabelText('Пароль'), 'correct horse battery staple');
  await userEvent.click(screen.getByRole('button', { name: 'Войти' }));
  expect(signIn).toHaveBeenCalledWith('owner@example.com', 'correct horse battery staple');
  expect(router.replace).toHaveBeenCalledWith('/admin');
});
```

Define `renderAdminShell` and `renderLoginForm` in their respective test files with injected auth/router dependencies so tests do not require a live browser session.

- [ ] **Step 5: Implement shell and login route**

Navigation contains `Обзор`, `Отели`, `Заявки`, and `Выйти`. During session resolution render a neutral loading state, not protected content. On unauthorized state call `router.replace('/admin/login')`.

- [ ] **Step 6: Run focused verification**

Run: `npm test -- --run lib/admin/auth.test.ts components/admin/admin-shell.test.tsx components/admin/login-form.test.tsx && npm run lint`
Expected: all auth/UI tests pass and lint exits 0.

- [ ] **Step 7: Commit**

```powershell
git add lib/admin/auth* components/admin/admin-shell* components/admin/login-form* app/admin
git commit -m "feat: protect the MehmonGo super admin"
```

---

### Task 2: Add typed hotel repository and create/edit form

**Files:**
- Create: `lib/admin/hotels.ts`
- Test: `lib/admin/hotels.test.ts`
- Create: `components/admin/hotel-form.tsx`
- Test: `components/admin/hotel-form.test.tsx`

**Interfaces:**
- Produces: `Hotel`, `HotelInput`.
- Produces: `listHotels()`, `getHotel(id)`, `createHotel(input)`, `updateHotel(id, input)`, `setHotelActive(id, active)`.
- `HotelInput = { name: string; slug: string; address: string; commissionPercent: string }`.

- [ ] **Step 1: Write failing repository tests**

```ts
it('converts display percent to basis points', async () => {
  await createHotel({ name: 'Kamilovs Hotel', slug: 'kamilovs', address: 'Samarkand', commissionPercent: '15' }, client);
  expect(client.from('hotels').insert).toHaveBeenCalledWith(expect.objectContaining({ commission_bps: 1500 }));
});

it('rejects malformed slug and commission', async () => {
  await expect(createHotel({ name: 'X', slug: 'Bad Slug', address: '', commissionPercent: '101' }, client)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
});
```

- [ ] **Step 2: Confirm RED**

Run: `npm test -- --run lib/admin/hotels.test.ts`
Expected: FAIL because repository is absent.

- [ ] **Step 3: Implement validation and repository methods**

Normalize slug to lowercase, require name length 2–120, validate address length 0–240, and accept decimal percent 0–100 with at most two decimals. Convert with `Math.round(Number(percent) * 100)`.

- [ ] **Step 4: Write failing form tests**

```ts
it('creates a hotel and resets after success', async () => {
  const createHotel = vi.fn().mockResolvedValue({ id: 'hotel-1' });
  renderHotelForm({ createHotel });
  await fillHotelForm({ name: 'Kamilovs Hotel', slug: 'kamilovs', address: 'Samarkand', percentage: '15' });
  await userEvent.click(screen.getByRole('button', { name: 'Создать отель' }));
  expect(createHotel).toHaveBeenCalledWith(expect.objectContaining({ slug: 'kamilovs', commissionPercent: '15' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Отель создан');
  expect(screen.getByLabelText('Название')).toHaveValue('');
});

it('shows duplicate slug error next to slug', async () => {
  renderHotelForm({ createHotel: vi.fn().mockRejectedValue({ code: '23505' }) });
  await fillHotelForm({ name: 'Kamilovs Hotel', slug: 'kamilovs', address: '', percentage: '15' });
  await userEvent.click(screen.getByRole('button', { name: 'Создать отель' }));
  expect(await screen.findByText('Такой slug уже используется')).toHaveAttribute('id', 'slug-error');
});

it('does not submit invalid percentage', async () => {
  const createHotel = vi.fn();
  renderHotelForm({ createHotel });
  await fillHotelForm({ name: 'Kamilovs Hotel', slug: 'kamilovs', address: '', percentage: '101' });
  await userEvent.click(screen.getByRole('button', { name: 'Создать отель' }));
  expect(screen.getByText('Введите процент от 0 до 100')).toBeInTheDocument();
  expect(createHotel).not.toHaveBeenCalled();
});
```

Define `fillHotelForm` in the test file as a Testing Library helper that fills the four labeled inputs.

- [ ] **Step 5: Implement accessible form**

Fields: `Название`, `Slug`, `Адрес`, `Процент отеля`. Disable submit while pending; map Postgres `23505` to `Такой slug уже используется`.

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- --run lib/admin/hotels.test.ts components/admin/hotel-form.test.tsx && npm run lint`
Expected: all tests pass.

```powershell
git add lib/admin/hotels* components/admin/hotel-form*
git commit -m "feat: create and edit partner hotels"
```

---

### Task 3: Build hotel list and hotel detail routes

**Files:**
- Create: `components/admin/hotel-list.tsx`
- Test: `components/admin/hotel-list.test.tsx`
- Create: `app/admin/hotels/page.tsx`
- Create: `app/admin/hotels/[id]/page.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes all `lib/admin/hotels.ts` operations.
- Produces navigation from a hotel row to `/admin/hotels/<id>`.

- [ ] **Step 1: Write failing list tests**

```ts
it('renders hotel name, commission, status and room link', async () => {
  renderHotelList({ hotels: [kamilovsFixture] });
  expect(screen.getByText('Kamilovs Hotel')).toBeInTheDocument();
  expect(screen.getByText('15%')).toBeInTheDocument();
  expect(screen.getByText('Активен')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Открыть Kamilovs Hotel' })).toHaveAttribute('href', '/admin/hotels/hotel-1');
});

it('requires confirmation before disabling a hotel', async () => {
  const setActive = vi.fn();
  renderHotelList({ hotels: [kamilovsFixture], setHotelActive: setActive });
  await userEvent.click(screen.getByRole('button', { name: 'Отключить Kamilovs Hotel' }));
  expect(setActive).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Подтвердить отключение' }));
  expect(setActive).toHaveBeenCalledWith('hotel-1', false);
});

it('refreshes the list after activation changes', async () => {
  const reload = vi.fn();
  renderHotelList({ hotels: [kamilovsFixture], setHotelActive: vi.fn().mockResolvedValue(undefined), reload });
  await userEvent.click(screen.getByRole('button', { name: 'Отключить Kamilovs Hotel' }));
  await userEvent.click(screen.getByRole('button', { name: 'Подтвердить отключение' }));
  await waitFor(() => expect(reload).toHaveBeenCalledOnce());
});
```

Define `kamilovsFixture` and `renderHotelList` as local typed fixtures in the test file.

- [ ] **Step 2: Confirm RED**

Run: `npm test -- --run components/admin/hotel-list.test.tsx`
Expected: FAIL because list is absent.

- [ ] **Step 3: Implement routes and responsive list**

The list must work as a table on desktop and labeled cards on mobile. The detail page loads one hotel, renders `HotelForm` in edit mode, and reserves a `Комнаты` section for Task 5.

- [ ] **Step 4: Add focused admin styles**

Use existing MehmonGo colors, 44px minimum controls, visible focus, and no guest-page layout coupling. Add `.admin-*` classes only; do not refactor existing guest styles.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- --run components/admin/hotel-list.test.tsx && npm run lint && npm run build`
Expected: list test, lint, and build pass.

```powershell
git add components/admin/hotel-list* app/admin/hotels app/globals.css
git commit -m "feat: add hotel management screens"
```

---

### Task 4: Parse arbitrary room lists and create rooms atomically

**Files:**
- Create: `lib/admin/rooms.ts`
- Test: `lib/admin/rooms.test.ts`
- Add via CLI: the `create_rooms_batch` migration path printed by `supabase migration new create_rooms_batch`
- Modify: `supabase/tests/database/request_intake.test.sql`

**Interfaces:**
- Produces: `parseRoomLabels(input: string): { labels: string[]; duplicates: string[] }`.
- Produces database RPC: `create_rooms_batch(target_hotel_id uuid, room_labels text[]) returns setof rooms`.
- Produces: `createRooms(hotelId, labels)`, `listRooms(hotelId)`, `setRoomActive(roomId, active)`.

- [ ] **Step 1: Write failing parser tests**

```ts
it('accepts arbitrary room labels and removes blank lines', () => {
  expect(parseRoomLabels('101\n102A\n\nVilla 3')).toEqual({ labels: ['101', '102A', 'Villa 3'], duplicates: [] });
});

it('reports duplicates case-insensitively', () => {
  expect(parseRoomLabels('Penthouse\npenthouse')).toEqual({ labels: ['Penthouse'], duplicates: ['penthouse'] });
});
```

- [ ] **Step 2: Confirm RED**

Run: `npm test -- --run lib/admin/rooms.test.ts`
Expected: FAIL because parser is absent.

- [ ] **Step 3: Implement parser and repository**

Trim each line, preserve display case, reject labels over 40 characters, cap one batch at 300 labels, and do not silently discard duplicates.

- [ ] **Step 4: Create the batch RPC through a CLI-generated migration**

```powershell
npx supabase@2.116.0 migration new create_rooms_batch
```

The function must be `security invoker`, require `private.is_super_admin()`, verify target hotel exists, insert all labels in one statement, and fail the whole batch on a conflicting `(hotel_id, label)`.

- [ ] **Step 5: Extend pgTAP tests**

Assert anonymous execution is denied, non-admin execution is denied, super-admin execution returns all rooms, and a duplicate rolls back the full batch.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- --run lib/admin/rooms.test.ts && npm run supabase:test`
Expected: parser and database tests pass.

```powershell
git add lib/admin/rooms* supabase/migrations supabase/tests
git commit -m "feat: add arbitrary hotel room batches"
```

---

### Task 5: Add room editor to the hotel detail screen

**Files:**
- Create: `components/admin/room-editor.tsx`
- Test: `components/admin/room-editor.test.tsx`
- Modify: `app/admin/hotels/[id]/page.tsx`

**Interfaces:**
- Consumes: `parseRoomLabels`, `createRooms`, `listRooms`, `setRoomActive`.
- Produces selected room IDs for the A5 generator plan.

- [ ] **Step 1: Write failing UI tests**

```ts
it('creates newline-separated rooms', async () => {
  const createRooms = vi.fn().mockResolvedValue([]);
  renderRoomEditor({ createRooms, rooms: [] });
  await userEvent.type(screen.getByLabelText('Список комнат'), '101\n102A\nVilla 3');
  await userEvent.click(screen.getByRole('button', { name: 'Добавить комнаты' }));
  expect(createRooms).toHaveBeenCalledWith('hotel-1', ['101', '102A', 'Villa 3']);
});

it('shows duplicate labels before submit', async () => {
  const createRooms = vi.fn();
  renderRoomEditor({ createRooms, rooms: [] });
  await userEvent.type(screen.getByLabelText('Список комнат'), 'Penthouse\npenthouse');
  await userEvent.click(screen.getByRole('button', { name: 'Добавить комнаты' }));
  expect(screen.getByText('Повторяется: penthouse')).toBeInTheDocument();
  expect(createRooms).not.toHaveBeenCalled();
});

it('can disable a room after inline confirmation', async () => {
  const setRoomActive = vi.fn();
  renderRoomEditor({ rooms: [room205Fixture], setRoomActive });
  await userEvent.click(screen.getByRole('button', { name: 'Отключить комнату 205' }));
  await userEvent.click(screen.getByRole('button', { name: 'Подтвердить отключение 205' }));
  expect(setRoomActive).toHaveBeenCalledWith('room-205', false);
});

it('selects all active rooms for asset generation', async () => {
  const onSelectionChange = vi.fn();
  renderRoomEditor({ rooms: [room205Fixture, { ...room206Fixture, active: false }], onSelectionChange });
  await userEvent.click(screen.getByRole('checkbox', { name: 'Выбрать все активные комнаты' }));
  expect(onSelectionChange).toHaveBeenLastCalledWith(['room-205']);
});
```

Define `renderRoomEditor`, `room205Fixture`, and `room206Fixture` in the component test file.

- [ ] **Step 2: Confirm RED**

Run: `npm test -- --run components/admin/room-editor.test.tsx`
Expected: FAIL because editor is absent.

- [ ] **Step 3: Implement editor**

Provide `Добавить одну комнату` and `Вставить список` modes backed by the same parser. Show room label, active status, short token preview, selection checkbox, and activation action. Never show the full guest URL in the table; provide a copy action that builds it from `SITE_URL` only when requested.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- --run components/admin/room-editor.test.tsx && npm run lint && npm run build`
Expected: tests, lint, and build pass.

```powershell
git add components/admin/room-editor* app/admin/hotels/[id]/page.tsx
git commit -m "feat: manage rooms from the super admin"
```

---

### Task 6: Build request repository, filters, and Telegram retry

**Files:**
- Create: `lib/admin/requests.ts`
- Test: `lib/admin/requests.test.ts`
- Create: `components/admin/request-table.tsx`
- Test: `components/admin/request-table.test.tsx`
- Create: `app/admin/requests/page.tsx`

**Interfaces:**
- Produces: `RequestFilters`, `AdminRequestRow`.
- Produces: `listRequests(filters)`, `retryTelegram(requestId)`.
- Filters: `hotelId`, `roomId`, `serviceType`, `status`, `dateFrom`, `dateTo`.

- [ ] **Step 1: Write failing repository tests**

```ts
it('applies hotel, category and inclusive date filters', async () => {
  const client = requestQueryClient([requestRowFixture]);
  await listRequests({ hotelId: 'hotel-1', serviceType: 'transport', dateFrom: '2026-08-01', dateTo: '2026-08-31' }, client);
  expect(client.filters).toEqual(expect.arrayContaining([
    ['eq', 'hotel_id', 'hotel-1'], ['eq', 'service_type', 'transport'],
    ['gte', 'created_at', '2026-08-01T00:00:00.000Z'], ['lt', 'created_at', '2026-09-01T00:00:00.000Z'],
  ]));
});

it('joins hotel, room and latest Telegram delivery', async () => {
  const result = await listRequests({}, requestQueryClient([requestRowFixture]));
  expect(result.items[0]).toMatchObject({ reference: 'MG-ABCDEFGH', hotelName: 'Kamilovs Hotel', roomLabel: '205', telegramStatus: 'failed' });
});

it('calls retry-telegram with authenticated invocation', async () => {
  const client = functionClient({ status: 'sent' });
  await retryTelegram('request-1', client);
  expect(client.functions.invoke).toHaveBeenCalledWith('retry-telegram', { body: { requestId: 'request-1' } });
});
```

Define `requestQueryClient`, `functionClient`, and `requestRowFixture` in the repository test file.

- [ ] **Step 2: Confirm RED**

Run: `npm test -- --run lib/admin/requests.test.ts`
Expected: FAIL because repository is absent.

- [ ] **Step 3: Implement typed queries**

Return at most 100 rows per page ordered by `created_at desc`. Convert date end to the next midnight for an inclusive filter. Select only fields rendered by the table.

- [ ] **Step 4: Write failing table tests**

```ts
it('renders request identity and delivery state', async () => {
  renderRequestTable({ rows: [adminRequestFixture] });
  expect(screen.getByText('MG-ABCDEFGH')).toBeInTheDocument();
  expect(screen.getByText('Kamilovs Hotel')).toBeInTheDocument();
  expect(screen.getByText('205')).toBeInTheDocument();
  expect(screen.getByText('Ошибка Telegram')).toBeInTheDocument();
});

it('shows retry only for failed delivery', async () => {
  renderRequestTable({ rows: [adminRequestFixture, { ...adminRequestFixture, id: 'request-2', telegramStatus: 'sent' }] });
  expect(screen.getAllByRole('button', { name: 'Повторить Telegram' })).toHaveLength(1);
});

it('updates one row after successful retry', async () => {
  const retryTelegram = vi.fn().mockResolvedValue({ status: 'sent' });
  renderRequestTable({ rows: [adminRequestFixture], retryTelegram });
  await userEvent.click(screen.getByRole('button', { name: 'Повторить Telegram' }));
  expect(await screen.findByText('Отправлено')).toBeInTheDocument();
  expect(retryTelegram).toHaveBeenCalledWith('request-1');
});
```

Define `renderRequestTable` and `adminRequestFixture` as local typed test helpers.

- [ ] **Step 5: Implement filters and retry UX**

Use Russian labels. Mask contact in the collapsed mobile row and reveal it only inside the request detail expansion. Retry has a pending state and reports the Telegram result without recreating the request.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- --run lib/admin/requests.test.ts components/admin/request-table.test.tsx && npm run lint && npm run build`
Expected: repository/UI tests, lint, and build pass.

```powershell
git add lib/admin/requests* components/admin/request-table* app/admin/requests
git commit -m "feat: review requests and retry Telegram"
```

---

### Task 7: Add dashboard metrics and complete admin verification

**Files:**
- Modify: `lib/admin/requests.ts`
- Modify: `lib/admin/requests.test.ts`
- Create: `components/admin/dashboard-cards.tsx`
- Test: `components/admin/dashboard-cards.test.tsx`
- Create: `app/admin/page.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `getDashboardMetrics(): Promise<{ activeHotels: number; activeRooms: number; newRequests: number }>`.

- [ ] **Step 1: Write failing metrics tests**

```ts
it('counts only active hotels and rooms and new requests', async () => {
  await expect(getDashboardMetrics(client)).resolves.toEqual({ activeHotels: 1, activeRooms: 24, newRequests: 7 });
});
```

- [ ] **Step 2: Confirm RED**

Run: `npm test -- --run lib/admin/requests.test.ts components/admin/dashboard-cards.test.tsx`
Expected: FAIL because metrics are absent.

- [ ] **Step 3: Implement metrics and dashboard**

Use three exact-count queries with RLS, render `Активные отели`, `Активные комнаты`, and `Новые заявки`, plus links to hotels and requests. Do not add financial analytics in this plan.

- [ ] **Step 4: Run the full admin gate**

Run:

```powershell
npm test -- --run
npm run lint
npm run build
npm audit --omit=dev
npm run supabase:test
```

Expected: all tests pass, lint/build exit 0, audit reports 0 production vulnerabilities, and database tests pass.

- [ ] **Step 5: Manually verify the admin scenario**

Using local Supabase and the seeded super-admin:

```text
anonymous /admin → /admin/login
owner login → dashboard
create hotel → visible in hotel list
paste 205 and 206 → two rooms created
disable 206 → its QR context returns unavailable
failed Telegram request → retry changes delivery to sent
```

- [ ] **Step 6: Commit**

```powershell
git add lib/admin/requests* components/admin/dashboard-cards* app/admin/page.tsx app/globals.css
git commit -m "feat: complete the MehmonGo super admin"
```
