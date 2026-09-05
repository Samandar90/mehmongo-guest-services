import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GuestNotice } from './guest-notice';

describe('GuestNotice', () => {
  it('shows the brand, the headline and the guidance', () => {
    render(
      <GuestNotice eyebrow="Room link" title="This room link is unavailable">
        <p>Please ask reception for a current code.</p>
      </GuestNotice>,
    );

    expect(screen.getByLabelText('MehmonGo')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'This room link is unavailable' })).toBeVisible();
    expect(screen.getByText('Please ask reception for a current code.')).toBeVisible();
  });
});
