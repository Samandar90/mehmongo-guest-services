'use client';

import { useEffect, useMemo, useRef, useState, type SubmitEvent } from 'react';
import {
  createRooms as createRoomsDefault,
  parseRoomLabels,
  roomBatchMaxSize,
  roomLabelMaxLength,
  setRoomActive as setRoomActiveDefault,
  type Room,
} from '@/lib/admin/rooms';
import { buildGuestRoomUrl } from '@/lib/site-url';

type RoomEditorProps = {
  hotelId: string;
  rooms: Room[];
  createRooms?: (hotelId: string, labels: string[]) => Promise<Room[]>;
  setRoomActive?: (roomId: string, active: boolean) => Promise<Room>;
  reload?: () => void | Promise<void>;
  onSelectionChange?: (roomIds: string[]) => void;
  /** Validated public guest-site origin; null disables link copying with an explanation. */
  siteUrl?: string | null;
  copyText?: (text: string) => Promise<void>;
};

type Mode = 'single' | 'list';

const messages = {
  conflict: 'Часть комнат уже существует. Список обновлён — проверьте его и повторите.',
  forbidden: 'Нет прав на изменение комнат. Войдите заново.',
  invalid: 'Не удалось добавить комнаты. Проверьте список и повторите.',
  createFailed: 'Не удалось добавить комнаты. Повторите попытку.',
  statusFailed: 'Не удалось изменить статус комнаты. Повторите попытку.',
  copyFailed: 'Не удалось скопировать ссылку. Повторите попытку.',
  noSiteUrl: 'Гостевой адрес сайта не настроен (VITE_SITE_URL)',
};

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null ? (error as { code?: unknown }).code as string | undefined : undefined;
}

function defaultCopyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

async function swallowReload(reload?: () => void | Promise<void>) {
  try {
    await reload?.();
  } catch {
    // The list keeps its last successfully loaded rows; the page owns retry.
  }
}

export function RoomEditor({
  hotelId,
  rooms,
  createRooms = createRoomsDefault,
  setRoomActive = setRoomActiveDefault,
  reload,
  onSelectionChange,
  siteUrl = null,
  copyText = defaultCopyText,
}: RoomEditorProps) {
  const [mode, setMode] = useState<Mode>('list');
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const draftRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const activeIds = useMemo(() => rooms.filter((room) => room.active).map((room) => room.id), [rooms]);
  const existingLabels = useMemo(() => new Set(rooms.map((room) => room.label)), [rooms]);

  const selectedActive = useMemo(
    () => selected.filter((id) => activeIds.includes(id)),
    [selected, activeIds],
  );
  const selectionKey = selectedActive.join('\n');
  const lastNotifiedSelection = useRef<string | null>(null);

  useEffect(() => {
    // Notify only when the effective (active) selection changes, including when a
    // selected room is disabled and silently leaves the selection.
    if (lastNotifiedSelection.current === selectionKey) return;
    lastNotifiedSelection.current = selectionKey;
    onSelectionChange?.(selectedActive);
  }, [onSelectionChange, selectedActive, selectionKey]);

  const allActiveSelected = activeIds.length > 0 && activeIds.every((id) => selectedActive.includes(id));

  const toggleAll = () => {
    setSelected(allActiveSelected ? [] : activeIds);
  };

  const toggleRoom = (roomId: string) => {
    setSelected((current) => (current.includes(roomId) ? current.filter((id) => id !== roomId) : [...current, roomId]));
  };

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);
    setFormError(null);
    setDraftError(null);

    const parsed = parseRoomLabels(draft);
    const problem = parsed.tooLong
      ? `Длиннее ${roomLabelMaxLength} символов: ${parsed.tooLong.join(', ')}`
      : parsed.duplicates.length > 0
        ? `Повторяется: ${parsed.duplicates.join(', ')}`
        : parsed.labels.length === 0
          ? 'Добавьте хотя бы одну комнату'
          : parsed.labels.length > roomBatchMaxSize
            ? `За один раз можно добавить не больше ${roomBatchMaxSize} комнат`
            : null;
    const existing = parsed.labels.filter((label) => existingLabels.has(label));
    const finalProblem = problem ?? (existing.length > 0 ? `Уже существуют: ${existing.join(', ')}` : null);
    if (finalProblem) {
      setDraftError(finalProblem);
      draftRef.current?.focus();
      return;
    }

    setAdding(true);
    try {
      const created = await createRooms(hotelId, parsed.labels);
      setDraft('');
      setNotice(`Добавлено комнат: ${created.length}`);
      await swallowReload(reload);
    } catch (error) {
      const code = errorCode(error);
      if (code === '23505') {
        setFormError(messages.conflict);
        await swallowReload(reload);
      } else if (code === '42501') {
        setFormError(messages.forbidden);
      } else if (code === '22023' || code === 'P0002' || code === 'VALIDATION_ERROR') {
        setFormError(messages.invalid);
      } else {
        setFormError(messages.createFailed);
      }
    } finally {
      setAdding(false);
    }
  };

  const changeStatus = async (room: Room, active: boolean) => {
    setConfirmingId(null);
    setPendingId(room.id);
    setFormError(null);
    setNotice(null);
    let changed = false;
    try {
      await setRoomActive(room.id, active);
      changed = true;
    } catch {
      setFormError(messages.statusFailed);
    } finally {
      setPendingId(null);
    }
    if (!changed) return;
    setNotice(`Комната ${room.label} ${active ? 'включена' : 'отключена'}`);
    await swallowReload(reload);
  };

  const copyLink = async (room: Room) => {
    if (!siteUrl) return;
    setFormError(null);
    setNotice(null);
    try {
      await copyText(buildGuestRoomUrl(siteUrl, room.publicToken));
      setNotice(`Ссылка для ${room.label} скопирована`);
    } catch {
      setFormError(messages.copyFailed);
    }
  };

  const draftId = 'room-draft';
  const draftErrorId = 'room-draft-error';

  return (
    <div className="admin-room-editor">
      <form className="admin-form admin-room-form" onSubmit={submit} noValidate>
        <fieldset className="admin-mode">
          <legend>Как добавить</legend>
          <label>
            <input type="radio" name="room-mode" value="single" checked={mode === 'single'} onChange={() => { setMode('single'); setDraftError(null); }} />
            Добавить одну комнату
          </label>
          <label>
            <input type="radio" name="room-mode" value="list" checked={mode === 'list'} onChange={() => { setMode('list'); setDraftError(null); }} />
            Вставить список
          </label>
        </fieldset>

        <div className="admin-field">
          <label htmlFor={draftId}>{mode === 'single' ? 'Название комнаты' : 'Список комнат'}</label>
          {mode === 'single' ? (
            <input
              id={draftId}
              ref={(element) => { draftRef.current = element; }}
              value={draft}
              onChange={(event) => { setDraft(event.target.value); setDraftError(null); }}
              maxLength={roomLabelMaxLength}
              placeholder="205"
              aria-invalid={draftError ? true : undefined}
              aria-describedby={draftError ? draftErrorId : undefined}
              disabled={adding}
            />
          ) : (
            <textarea
              id={draftId}
              ref={(element) => { draftRef.current = element; }}
              value={draft}
              onChange={(event) => { setDraft(event.target.value); setDraftError(null); }}
              rows={6}
              placeholder={'205\n206\nVilla 3'}
              aria-invalid={draftError ? true : undefined}
              aria-describedby={draftError ? draftErrorId : undefined}
              disabled={adding}
            />
          )}
          <small className="admin-hint">Одна комната — одна строка, до {roomLabelMaxLength} символов, не больше {roomBatchMaxSize} за раз.</small>
          {draftError ? <p id={draftErrorId} className="admin-field-error">{draftError}</p> : null}
        </div>

        {formError ? <p role="alert" className="admin-form-error">{formError}</p> : null}
        {notice ? <output className="admin-form-success">{notice}</output> : null}

        <button type="submit" disabled={adding}>
          {adding ? 'Сохранение…' : mode === 'single' ? 'Добавить комнату' : 'Добавить комнаты'}
        </button>
      </form>

      {rooms.length === 0 ? (
        <p className="admin-empty">Комнат пока нет</p>
      ) : (
        <div className="admin-table-wrap">
          {!siteUrl ? <p className="admin-hint">{messages.noSiteUrl}</p> : null}
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">
                  <input
                    type="checkbox"
                    aria-label="Выбрать все активные комнаты"
                    checked={allActiveSelected}
                    disabled={activeIds.length === 0}
                    onChange={toggleAll}
                  />
                </th>
                <th scope="col">Комната</th>
                <th scope="col">Токен</th>
                <th scope="col">Статус</th>
                <th scope="col">Действия</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => {
                const pending = pendingId === room.id;
                const confirming = confirmingId === room.id;
                return (
                  <tr key={room.id} data-active={room.active}>
                    <td data-label="Выбор">
                      <input
                        type="checkbox"
                        aria-label={`Выбрать комнату ${room.label}`}
                        checked={room.active && selected.includes(room.id)}
                        disabled={!room.active}
                        onChange={() => toggleRoom(room.id)}
                      />
                    </td>
                    <td data-label="Комната"><strong>{room.label}</strong></td>
                    <td data-label="Токен"><code>{`${room.publicToken.slice(0, 8)}…`}</code></td>
                    <td data-label="Статус">
                      <span className={room.active ? 'admin-badge admin-badge-active' : 'admin-badge admin-badge-inactive'}>
                        {room.active ? 'Активна' : 'Отключена'}
                      </span>
                    </td>
                    <td data-label="Действия" className="admin-actions">
                      <button
                        type="button"
                        className="admin-button admin-button-secondary"
                        aria-label={`Скопировать ссылку для ${room.label}`}
                        disabled={!siteUrl}
                        onClick={() => { void copyLink(room); }}
                      >
                        Скопировать ссылку
                      </button>
                      {pending ? (
                        <button type="button" className="admin-button admin-button-secondary" disabled>Сохранение…</button>
                      ) : confirming ? (
                        <span className="admin-confirm">
                          <button
                            type="button"
                            className="admin-button admin-button-danger"
                            aria-label={`Подтвердить отключение ${room.label}`}
                            onClick={() => { void changeStatus(room, false); }}
                          >
                            Подтвердить отключение
                          </button>
                          <button type="button" className="admin-button admin-button-secondary" onClick={() => setConfirmingId(null)}>
                            Отмена
                          </button>
                        </span>
                      ) : room.active ? (
                        <button
                          type="button"
                          className="admin-button admin-button-secondary"
                          aria-label={`Отключить комнату ${room.label}`}
                          onClick={() => { setFormError(null); setConfirmingId(room.id); }}
                        >
                          Отключить
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="admin-button admin-button-secondary"
                          aria-label={`Включить комнату ${room.label}`}
                          onClick={() => { void changeStatus(room, true); }}
                        >
                          Включить
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
