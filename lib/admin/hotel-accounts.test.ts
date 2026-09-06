import { describe, expect, it, vi } from 'vitest';
import { AdminRequestError } from '@/lib/admin/errors';
import { createHotelAccount, listHotelAccounts, setHotelAccountActive } from '@/lib/admin/hotel-accounts';

function functionClient(response: { status: number; body: unknown }) {
  const invoke = vi.fn().mockResolvedValue(
    response.status < 300
      ? { data: response.body, error: null }
      : {
        data: null,
        error: {
          name: 'FunctionsHttpError',
          message: 'Edge Function returned a non-2xx status code',
          context: new Response(JSON.stringify(response.body), {
            status: response.status,
            headers: { 'content-type': 'application/json' },
          }),
        },
      },
  );
  return { client: { functions: { invoke } } as never, invoke };
}

const account = { userId: 'user-2', email: 'reception@example.test', active: true };

describe('listHotelAccounts', () => {
  it('asks the function for one hotel', async () => {
    const { client, invoke } = functionClient({ status: 200, body: { accounts: [account] } });

    await expect(listHotelAccounts('hotel-1', client)).resolves.toEqual([account]);
    expect(invoke).toHaveBeenCalledWith('hotel-accounts', { body: { action: 'list', hotelId: 'hotel-1' } });
  });

  it('reports a caller who is no longer the owner', async () => {
    const { client } = functionClient({ status: 403, body: { code: 'FORBIDDEN' } });
    await expect(listHotelAccounts('hotel-1', client)).rejects.toThrow(AdminRequestError);
  });
});

describe('createHotelAccount', () => {
  it('returns the password once, alongside the account', async () => {
    const { client, invoke } = functionClient({ status: 201, body: { account, password: 'Kq7mRt2vXb9pLn4sWd6h' } });

    await expect(createHotelAccount('hotel-1', 'Reception@Example.test', client)).resolves.toEqual({
      account, password: 'Kq7mRt2vXb9pLn4sWd6h',
    });
    expect(invoke).toHaveBeenCalledWith('hotel-accounts', {
      body: { action: 'create', hotelId: 'hotel-1', email: 'Reception@Example.test' },
    });
  });

  it('names an address that already has an account, so the owner can pick another', async () => {
    const { client } = functionClient({ status: 409, body: { code: 'EMAIL_TAKEN' } });
    await expect(createHotelAccount('hotel-1', 'taken@example.test', client))
      .rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
  });

  it('refuses a response that carries no password rather than pretending it worked', async () => {
    const { client } = functionClient({ status: 201, body: { account } });
    await expect(createHotelAccount('hotel-1', 'reception@example.test', client)).rejects.toThrow(AdminRequestError);
  });
});

describe('setHotelAccountActive', () => {
  it('disables an account', async () => {
    const { client, invoke } = functionClient({ status: 200, body: { userId: 'user-2', active: false } });

    await expect(setHotelAccountActive('user-2', false, client)).resolves.toEqual({ userId: 'user-2', active: false });
    expect(invoke).toHaveBeenCalledWith('hotel-accounts', {
      body: { action: 'setActive', userId: 'user-2', active: false },
    });
  });

  it('reports an account that is already gone', async () => {
    const { client } = functionClient({ status: 404, body: { code: 'ACCOUNT_NOT_FOUND' } });
    await expect(setHotelAccountActive('user-2', false, client)).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  });
});
