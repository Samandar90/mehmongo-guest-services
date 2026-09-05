'use client';

import { useRef, useState, type SubmitEvent } from 'react';
import {
  createHotel as createHotelDefault,
  formatCommissionPercent,
  hotelCatalogOptions,
  isDuplicateSlugError,
  updateHotel as updateHotelDefault,
  validateHotelInput,
  type Hotel,
  type HotelFieldErrors,
  type HotelInput,
} from '@/lib/admin/hotels';

type HotelFormProps = {
  hotel?: Hotel;
  createHotel?: (input: HotelInput) => Promise<Hotel>;
  updateHotel?: (id: string, input: HotelInput) => Promise<Hotel>;
  onSaved?: (hotel: Hotel) => void;
};

type FieldKey = keyof HotelInput;

const fieldOrder: FieldKey[] = ['name', 'slug', 'address', 'commissionPercent'];

const fieldLabels: Record<FieldKey, string> = {
  name: 'Название',
  slug: 'Slug',
  address: 'Адрес',
  commissionPercent: 'Процент отеля',
  guestCatalogId: 'Гостевой каталог',
};

const emptyInput: HotelInput = { name: '', slug: '', address: '', commissionPercent: '', guestCatalogId: '' };
const duplicateSlugMessage = 'Такой slug уже используется';
const genericErrorMessage = 'Не удалось сохранить отель. Повторите попытку.';

function toInput(hotel: Hotel): HotelInput {
  return {
    name: hotel.name,
    slug: hotel.slug,
    address: hotel.address,
    commissionPercent: formatCommissionPercent(hotel.commissionBps),
    guestCatalogId: hotel.guestCatalogId ?? '',
  };
}

function isValidationError(error: unknown): error is { code: 'VALIDATION_ERROR'; fields: HotelFieldErrors } {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'VALIDATION_ERROR';
}

export function HotelForm({
  hotel,
  createHotel = createHotelDefault,
  updateHotel = updateHotelDefault,
  onSaved,
}: HotelFormProps) {
  const isEdit = hotel !== undefined;
  const [values, setValues] = useState<HotelInput>(hotel ? toInput(hotel) : emptyInput);
  const [fieldErrors, setFieldErrors] = useState<HotelFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputs = useRef<Partial<Record<FieldKey, HTMLInputElement | null>>>({});

  const focusFirstInvalid = (errors: HotelFieldErrors) => {
    const key = fieldOrder.find((field) => errors[field]);
    if (key) inputs.current[key]?.focus();
  };

  const setField = (key: FieldKey, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
    setFormError(null);
    setSuccess(null);
  };

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSuccess(null);
    setFormError(null);

    const validation = validateHotelInput(values);
    if (!validation.ok) {
      setFieldErrors(validation.errors);
      focusFirstInvalid(validation.errors);
      return;
    }

    setFieldErrors({});
    setPending(true);
    try {
      const saved = isEdit ? await updateHotel(hotel.id, values) : await createHotel(values);
      setValues(isEdit ? toInput(saved) : emptyInput);
      setSuccess(isEdit ? 'Изменения сохранены' : 'Отель создан');
      onSaved?.(saved);
    } catch (error) {
      if (isDuplicateSlugError(error)) {
        setFieldErrors({ slug: duplicateSlugMessage });
        focusFirstInvalid({ slug: duplicateSlugMessage });
      } else if (isValidationError(error)) {
        setFieldErrors(error.fields);
        focusFirstInvalid(error.fields);
      } else {
        setFormError(genericErrorMessage);
      }
    } finally {
      setPending(false);
    }
  };

  const renderField = (key: FieldKey, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => {
    const id = `hotel-${key}`;
    const errorId = `${key}-error`;
    const error = fieldErrors[key];
    return (
      <div className="admin-field">
        <label htmlFor={id}>{fieldLabels[key]}</label>
        <input
          id={id}
          name={key}
          ref={(element) => { inputs.current[key] = element; }}
          value={values[key]}
          onChange={(event) => setField(key, event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          disabled={pending}
          {...extra}
        />
        {error ? <p id={errorId} className="admin-field-error">{error}</p> : null}
      </div>
    );
  };

  return (
    <form className="admin-form" onSubmit={submit} noValidate>
      {renderField('name', { autoComplete: 'organization', maxLength: 120 })}
      {renderField('slug', { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false })}
      {renderField('address', { autoComplete: 'street-address', maxLength: 240 })}
      {renderField('commissionPercent', { inputMode: 'decimal', placeholder: '15' })}
      <div className="admin-field">
        <label htmlFor="hotel-guestCatalogId">{fieldLabels.guestCatalogId}</label>
        <select
          id="hotel-guestCatalogId"
          name="guestCatalogId"
          value={values.guestCatalogId}
          onChange={(event) => setField('guestCatalogId', event.target.value)}
          aria-invalid={fieldErrors.guestCatalogId ? true : undefined}
          aria-describedby={fieldErrors.guestCatalogId ? 'guestCatalogId-error' : undefined}
          disabled={pending}
        >
          {hotelCatalogOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <small className="admin-hint">Каталог включается вручную и только для отелей выбранного города.</small>
        {fieldErrors.guestCatalogId ? <p id="guestCatalogId-error" className="admin-field-error">{fieldErrors.guestCatalogId}</p> : null}
      </div>
      {formError ? <p role="alert" className="admin-form-error">{formError}</p> : null}
      {success ? <output className="admin-form-success">{success}</output> : null}
      <button type="submit" disabled={pending}>
        {pending ? 'Сохранение…' : isEdit ? 'Сохранить' : 'Создать отель'}
      </button>
    </form>
  );
}
