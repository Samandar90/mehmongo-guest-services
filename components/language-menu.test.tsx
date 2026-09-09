import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LanguageMenu } from './language-menu';

describe('LanguageMenu', () => {
  it('shows the current language and opens a menu of all four', async () => {
    const user = userEvent.setup();
    render(<LanguageMenu locale="en" onChange={vi.fn()} />);

    const pill = screen.getByRole('button', { name: 'Language: English' });
    expect(pill).toHaveTextContent('EN');
    expect(pill).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(pill);

    const menu = screen.getByRole('menu', { name: 'Choose a language' });
    const options = within(menu).getAllByRole('menuitemradio');
    expect(options.map((option) => option.textContent)).toEqual([
      'ENEnglish',
      'RUРусскийRussian',
      'UZOʻzbekchaUzbek',
      'ZH中文Chinese',
    ]);
    expect(options[0]).toHaveAttribute('aria-checked', 'true');
    expect(options[0]).toHaveFocus();
    expect(pill).toHaveAttribute('aria-expanded', 'true');
  });

  it('reports the chosen language and closes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LanguageMenu locale="en" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Language: English' }));
    await user.click(screen.getByRole('menuitemradio', { name: /Русский/ }));

    expect(onChange).toHaveBeenCalledWith('ru');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Language: English' })).toHaveFocus();
  });

  it('labels itself in the current language', async () => {
    const user = userEvent.setup();
    render(<LanguageMenu locale="zh" onChange={vi.fn()} />);

    const pill = screen.getByRole('button', { name: '语言: 中文' });
    expect(pill).toHaveTextContent('ZH');
    await user.click(pill);
    expect(screen.getByRole('menu', { name: '选择语言' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: /中文/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('closes on Escape and moves with the arrow keys', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LanguageMenu locale="ru" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Язык: Русский' }));
    expect(screen.getByRole('menuitemradio', { name: /Русский/ })).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: /Oʻzbekcha/ })).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('menuitemradio', { name: /English/ })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('menuitemradio', { name: /中文/ })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Язык: Русский' })).toHaveFocus();
  });

  it('closes when the guest taps elsewhere', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <LanguageMenu locale="en" onChange={vi.fn()} />
        <p>Elsewhere</p>
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'Language: English' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByText('Elsewhere'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does not report the language already in use', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LanguageMenu locale="uz" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Til: Oʻzbekcha' }));
    await user.click(screen.getByRole('menuitemradio', { name: /Oʻzbekcha/ }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
