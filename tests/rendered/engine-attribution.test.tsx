import { render, screen } from '@testing-library/react';

import { EngineAttribution } from '@/components/chess/EngineAttribution';
import { ENGINE_SOURCE_URL } from '@/lib/chess/engine';

/**
 * The attribution is a GPL-3 CONDITION, not a credit.
 *
 * The licence requires that recipients can obtain the source. A link that does
 * not render, or renders without an href, satisfies nothing — so this asserts on
 * what a USER actually sees.
 */
describe('the Stockfish attribution', () => {
  it('renders a working link to the SOURCE', () => {
    render(<EngineAttribution />);

    const source = screen.getByRole('link', { name: /stockfish/i });
    expect(source).toHaveAttribute('href', ENGINE_SOURCE_URL);
  });

  it('renders a link to the LICENCE text', () => {
    render(<EngineAttribution />);

    const licence = screen.getByRole('link', { name: /gpl/i });
    expect(licence).toHaveAttribute('href', '/engine/LICENSE');
  });

  it('names the engine and says it is unmodified', () => {
    render(<EngineAttribution />);

    expect(screen.getByText(/unmodified/i)).toBeInTheDocument();
  });
});
