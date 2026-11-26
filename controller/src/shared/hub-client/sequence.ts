/**
 * The counter for this Controller's envelopes, from the clock so that nothing
 * has to be stored: the Keychain survives deleting the app where SQLite does
 * not, and a receiver only needs the number to go up. It still goes up when the
 * clock steps back or envelopes come faster than it ticks.
 *
 * ponytail: a clock set far back and an app restarted is refused until the time
 * catches up. Store the last number if that shows up in practice.
 */
export function clockSequence(now: () => number = Date.now) {
  let last = 0;
  return () => {
    last = Math.max(now(), last + 1);
    return last;
  };
}
