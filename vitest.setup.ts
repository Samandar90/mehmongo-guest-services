import '@testing-library/jest-dom/vitest';

// jsdom lays nothing out and implements no scrolling; the guest screens
// scroll an offer card back into view on the way back from its form. Suites
// on the node environment have no DOM at all.
if (typeof Element !== 'undefined') Element.prototype.scrollIntoView = () => {};
