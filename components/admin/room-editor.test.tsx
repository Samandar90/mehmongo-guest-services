import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RoomEditor } from './room-editor';
import type { Room } from '@/lib/admin/rooms';

const room205Fixture: Room = {
  id: 'room-205',
  hotelId: 'hotel-1',
  label: '205',
  publicToken: '9c6f6f5e-2b6d-4c0f-9a7d-1f2e3d4c5b6a',
  active: true,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
};

const room206Fixture: Room = {
  ...room205Fixture,
  id: 'room-206',
  label: '206',
  publicToken: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
};

type EditorProps = {
  rooms: Room[];
  createRooms?: (hotelId: string, labels: string[]) => Promise<Room[]>;
  setRoomActive?: (roomId: string, active: boolean) => Promise<Room>;
  reload?: () => void | Promise<void>;
  onSelectionChange?: (roomIds: string[]) => void;
  siteUrl?: string | null;
  copyText?: (text: string) => Promise<void>;
};

function renderRoomEditor(initial: EditorProps) {
  const element = (props: EditorProps) => (
    <RoomEditor
      hotelId="hotel-1"
      createRooms={props.createRooms ?? vi.fn().mockResolvedValue([])}
      setRoomActive={props.setRoomActive ?? vi.fn().mockResolvedValue(room205Fixture)}
      reload={props.reload}
      onSelectionChange={props.onSelectionChange}
      siteUrl={props.siteUrl ?? null}
      copyText={props.copyText}
      rooms={props.rooms}
    />
  );
  const { rerender } = render(element(initial));
  return { rerender: (next: Partial<EditorProps>) => rerender(element({ ...initial, ...next })) };
}

describe('RoomEditor', () => {
  it('creates newline-separated rooms', async () => {
    const user = userEvent.setup();
    const createRooms = vi.fn().mockResolvedValue([room205Fixture, room206Fixture, { ...room206Fixture, id: 'room-3', label: 'Villa 3' }]);
    const reload = vi.fn();
    renderRoomEditor({ createRooms, rooms: [], reload });

    await user.type(screen.getByLabelText('Список комнат'), '101\n102A\nVilla 3');
    await user.click(screen.getByRole('button', { name: 'Добавить комнаты' }));

    expect(createRooms).toHaveBeenCalledWith('hotel-1', ['101', '102A', 'Villa 3']);
    expect(await screen.findByRole('status')).toHaveTextContent('Добавлено комнат: 3');
    expect(screen.getByLabelText('Список комнат')).toHaveValue('');
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });

  it('shows duplicate labels before submit', async () => {
    const user = userEvent.setup();
    const createRooms = vi.fn();
    renderRoomEditor({ createRooms, rooms: [] });

    await user.type(screen.getByLabelText('Список комнат'), 'Penthouse\npenthouse');
    await user.click(screen.getByRole('button', { name: 'Добавить комнаты' }));

    expect(screen.getByText('Повторяется: penthouse')).toBeInTheDocument();
    expect(createRooms).not.toHaveBeenCalled();
  });

  it('adds a single room from the single-room mode', async () => {
    const user = userEvent.setup();
    const createRooms = vi.fn().mockResolvedValue([{ ...room205Fixture, label: 'Villa 3' }]);
    renderRoomEditor({ createRooms, rooms: [] });

    await user.click(screen.getByRole('radio', { name: 'Добавить одну комнату' }));
    await user.type(screen.getByLabelText('Название комнаты'), ' Villa 3 ');
    await user.click(screen.getByRole('button', { name: 'Добавить комнату' }));

    expect(createRooms).toHaveBeenCalledWith('hotel-1', ['Villa 3']);
    expect(await screen.findByRole('status')).toHaveTextContent('Добавлено комнат: 1');
  });

  it('reports labels that already exist for this hotel before submit', async () => {
    const user = userEvent.setup();
    const createRooms = vi.fn();
    renderRoomEditor({ createRooms, rooms: [room205Fixture] });

    await user.type(screen.getByLabelText('Список комнат'), '205\n207');
    await user.click(screen.getByRole('button', { name: 'Добавить комнаты' }));

    expect(screen.getByText('Уже существуют: 205')).toBeInTheDocument();
    expect(createRooms).not.toHaveBeenCalled();
  });

  it('reports over-long labels and oversized batches before submit', async () => {
    const user = userEvent.setup();
    const createRooms = vi.fn();
    renderRoomEditor({ createRooms, rooms: [] });
    const long = 'x'.repeat(41);

    await user.type(screen.getByLabelText('Список комнат'), `205\n${long}`);
    await user.click(screen.getByRole('button', { name: 'Добавить комнаты' }));
    expect(screen.getByText(`Длиннее 40 символов: ${long}`)).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Список комнат'));
    await user.click(screen.getByLabelText('Список комнат'));
    await user.paste(Array.from({ length: 301 }, (_, index) => `R${index}`).join('\n'));
    await user.click(screen.getByRole('button', { name: 'Добавить комнаты' }));
    expect(screen.getByText('За один раз можно добавить не больше 300 комнат')).toBeInTheDocument();
    expect(createRooms).not.toHaveBeenCalled();
  });

  it('maps a database conflict to an actionable message and refreshes the list', async () => {
    const user = userEvent.setup();
    const createRooms = vi.fn().mockRejectedValue({ code: '23505', message: 'duplicate key value' });
    const reload = vi.fn();
    renderRoomEditor({ createRooms, rooms: [], reload });

    await user.type(screen.getByLabelText('Список комнат'), '205');
    await user.click(screen.getByRole('button', { name: 'Добавить комнаты' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Часть комнат уже существует. Список обновлён — проверьте его и повторите.');
    expect(screen.getByLabelText('Список комнат')).toHaveValue('205');
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });

  it('can disable a room after inline confirmation', async () => {
    const user = userEvent.setup();
    const setRoomActive = vi.fn().mockResolvedValue({ ...room205Fixture, active: false });
    renderRoomEditor({ rooms: [room205Fixture], setRoomActive });

    await user.click(screen.getByRole('button', { name: 'Отключить комнату 205' }));
    expect(setRoomActive).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Подтвердить отключение 205' }));

    expect(setRoomActive).toHaveBeenCalledWith('room-205', false);
    expect(await screen.findByRole('status')).toHaveTextContent('Комната 205 отключена');
  });

  it('re-enables a room without confirmation and reports failures', async () => {
    const user = userEvent.setup();
    const setRoomActive = vi.fn().mockRejectedValue(new Error('network'));
    renderRoomEditor({ rooms: [{ ...room205Fixture, active: false }], setRoomActive });

    expect(screen.getByText('Отключена')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Включить комнату 205' }));

    expect(setRoomActive).toHaveBeenCalledWith('room-205', true);
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось изменить статус комнаты. Повторите попытку.');
    expect(screen.getByRole('button', { name: 'Включить комнату 205' })).toBeEnabled();
  });

  it('selects all active rooms for asset generation', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    renderRoomEditor({ rooms: [room205Fixture, { ...room206Fixture, active: false }], onSelectionChange });

    await user.click(screen.getByRole('checkbox', { name: 'Выбрать все активные комнаты' }));

    expect(onSelectionChange).toHaveBeenLastCalledWith(['room-205']);
    expect(screen.getByRole('checkbox', { name: 'Выбрать комнату 206' })).toBeDisabled();
    // Every checkbox sits inside a label so the tap target is the 44px label, not the 20px box.
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox.closest('label')).toHaveClass('admin-check');
    }
  });

  it('marks the select-all checkbox as indeterminate for a partial selection', async () => {
    const user = userEvent.setup();
    renderRoomEditor({ rooms: [room205Fixture, room206Fixture] });

    await user.click(screen.getByRole('checkbox', { name: 'Выбрать комнату 205' }));

    const selectAll = screen.getByRole('checkbox', { name: 'Выбрать все активные комнаты' }) as HTMLInputElement;
    expect(selectAll.indeterminate).toBe(true);
    expect(selectAll).not.toBeChecked();
  });

  it('removes a room from the selection when the admin disables it', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    const setRoomActive = vi.fn().mockResolvedValue({ ...room205Fixture, active: false });
    renderRoomEditor({ rooms: [room205Fixture, room206Fixture], onSelectionChange, setRoomActive });

    await user.click(screen.getByRole('checkbox', { name: 'Выбрать все активные комнаты' }));
    await user.click(screen.getByRole('button', { name: 'Отключить комнату 205' }));
    await user.click(screen.getByRole('button', { name: 'Подтвердить отключение 205' }));

    await waitFor(() => expect(onSelectionChange).toHaveBeenLastCalledWith(['room-206']));
  });

  it('keeps separate drafts for the single and list modes', async () => {
    const user = userEvent.setup();
    const createRooms = vi.fn().mockResolvedValue([room205Fixture]);
    renderRoomEditor({ createRooms, rooms: [] });

    await user.type(screen.getByLabelText('Список комнат'), '205\n206');
    await user.click(screen.getByRole('radio', { name: 'Добавить одну комнату' }));
    expect(screen.getByLabelText('Название комнаты')).toHaveValue('');

    await user.type(screen.getByLabelText('Название комнаты'), '207');
    await user.click(screen.getByRole('button', { name: 'Добавить комнату' }));
    expect(createRooms).toHaveBeenCalledWith('hotel-1', ['207']);

    await user.click(screen.getByRole('radio', { name: 'Вставить список' }));
    expect(screen.getByLabelText('Список комнат')).toHaveValue('205\n206');
  });

  it('explains a permission failure instead of suggesting a retry', async () => {
    const user = userEvent.setup();
    const setRoomActive = vi.fn().mockRejectedValue({ code: '42501', message: 'permission denied' });
    const createRooms = vi.fn().mockRejectedValue({ code: '42501', message: 'permission denied' });
    renderRoomEditor({ rooms: [room205Fixture], setRoomActive, createRooms });

    await user.click(screen.getByRole('button', { name: 'Отключить комнату 205' }));
    await user.click(screen.getByRole('button', { name: 'Подтвердить отключение 205' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Нет прав на изменение комнат. Войдите заново.');

    await user.type(screen.getByLabelText('Список комнат'), '206');
    await user.click(screen.getByRole('button', { name: 'Добавить комнаты' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Нет прав на изменение комнат. Войдите заново.');
  });

  it('reports a clipboard failure', async () => {
    const user = userEvent.setup();
    const copyText = vi.fn().mockRejectedValue(new Error('denied'));
    renderRoomEditor({ rooms: [room205Fixture], siteUrl: 'https://mehmongo.example', copyText });

    await user.click(screen.getByRole('button', { name: 'Скопировать ссылку для 205' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось скопировать ссылку. Повторите попытку.');
  });

  it('drops a room from the selection once it is disabled', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    const editor = renderRoomEditor({ rooms: [room205Fixture, room206Fixture], onSelectionChange });

    await user.click(screen.getByRole('checkbox', { name: 'Выбрать комнату 205' }));
    await user.click(screen.getByRole('checkbox', { name: 'Выбрать комнату 206' }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(['room-205', 'room-206']);

    editor.rerender({ rooms: [room205Fixture, { ...room206Fixture, active: false }] });

    await waitFor(() => expect(onSelectionChange).toHaveBeenLastCalledWith(['room-205']));
  });

  it('shows a short token preview and copies the full guest link only on request', async () => {
    const user = userEvent.setup();
    const copyText = vi.fn().mockResolvedValue(undefined);
    renderRoomEditor({ rooms: [room205Fixture], siteUrl: 'https://mehmongo.example', copyText });

    expect(screen.getByText('9c6f6f5e…')).toBeInTheDocument();
    expect(screen.queryByText(/mehmongo\.example\/r\//)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Скопировать ссылку для 205' }));

    expect(copyText).toHaveBeenCalledWith('https://mehmongo.example/r/9c6f6f5e-2b6d-4c0f-9a7d-1f2e3d4c5b6a');
    expect(await screen.findByRole('status')).toHaveTextContent('Ссылка для 205 скопирована');
  });

  it('explains why links cannot be copied when the site origin is not configured', () => {
    renderRoomEditor({ rooms: [room205Fixture], siteUrl: null });

    expect(screen.getByRole('button', { name: 'Скопировать ссылку для 205' })).toBeDisabled();
    expect(screen.getByText('Гостевой адрес сайта не настроен (VITE_SITE_URL)')).toBeInTheDocument();
  });
});
