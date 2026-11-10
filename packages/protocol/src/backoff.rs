/// Exponential backoff with full jitter: attempt n waits a random time up to
/// min(cap, base * 2^n), so Runtimes that lost the Hub together do not all
/// come back at the same instant. Reset after a successful connection.
#[derive(Debug, Clone)]
pub struct Backoff {
    base_ms: u64,
    cap_ms: u64,
    attempt: u32,
}

impl Backoff {
    pub fn new(base_ms: u64, cap_ms: u64) -> Self {
        Self {
            base_ms,
            cap_ms,
            attempt: 0,
        }
    }

    /// `random` is in `[0, 1)`, exactly like `Math.random()`.
    pub fn next_with(&mut self, random: f64) -> u64 {
        let ceiling = self
            .cap_ms
            .min(self.base_ms.saturating_mul(1u64 << self.attempt.min(30)));
        self.attempt = (self.attempt + 1).min(30);
        (random * ceiling as f64).round() as u64
    }

    pub fn reset(&mut self) {
        self.attempt = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn doubles_until_the_cap_and_resets() {
        let mut backoff = Backoff::new(1_000, 30_000);
        assert_eq!(backoff.next_with(0.5), 500);
        assert_eq!(backoff.next_with(0.5), 1_000);
        assert_eq!(backoff.next_with(0.5), 2_000);
        assert_eq!(backoff.next_with(0.5), 4_000);
        assert_eq!(backoff.next_with(0.5), 8_000);
        assert_eq!(backoff.next_with(0.5), 15_000);
        assert_eq!(backoff.next_with(0.5), 15_000);
        backoff.reset();
        assert_eq!(backoff.next_with(0.5), 500);
    }
}
