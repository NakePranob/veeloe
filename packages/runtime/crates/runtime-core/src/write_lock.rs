//! The Workdir's write lock (ADR 0080): Turns run at once and wait only to
//! write. A Turn takes the lock when it is about to write and keeps it until it
//! ends, so no other Turn's writes land between two of its own. A person's Turn
//! gets the lock before a background one (Schedule, Idle Work); within each,
//! first come first served. Reading never takes it.

use std::collections::VecDeque;
use std::sync::Mutex;

use tokio::sync::oneshot;
use veeloe_plugin_api::Cancel;

/// Who is asking: a person's Turn, or one a Trigger started.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Class {
    Person,
    Background,
}

#[derive(Default)]
struct Held {
    holder: Option<String>,
    person: VecDeque<(String, oneshot::Sender<()>)>,
    background: VecDeque<(String, oneshot::Sender<()>)>,
}

#[derive(Default)]
pub struct WriteLock {
    held: Mutex<Held>,
}

impl WriteLock {
    /// Waits until `task` holds the lock. False when the Turn was cancelled
    /// first (a Stop or its time limit): it never got the lock.
    pub async fn acquire(&self, task: &str, class: Class, cancel: &Cancel) -> bool {
        let mut granted = {
            let mut held = self.held.lock().expect("write lock");
            match held.holder.as_deref() {
                None => {
                    held.holder = Some(task.to_string());
                    return true;
                }
                Some(holder) if holder == task => return true,
                Some(_) => {}
            }
            let (grant, granted) = oneshot::channel();
            match class {
                Class::Person => held.person.push_back((task.to_string(), grant)),
                Class::Background => held.background.push_back((task.to_string(), grant)),
            }
            granted
        };
        tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                // Granted in the same instant it was cancelled: give it straight back.
                if granted.try_recv().is_ok() {
                    self.release(task);
                }
                false
            }
            result = &mut granted => result.is_ok(),
        }
    }

    /// The Turn ended: the lock goes to the next person waiting, else the next
    /// background Turn. A Turn that does not hold it releases nothing.
    pub fn release(&self, task: &str) {
        let mut held = self.held.lock().expect("write lock");
        if held.holder.as_deref() != Some(task) {
            return;
        }
        held.holder = None;
        loop {
            let next = held
                .person
                .pop_front()
                .or_else(|| held.background.pop_front());
            let Some((waiter, grant)) = next else {
                return;
            };
            // A waiter that gave up (its receiver is gone) is skipped.
            if grant.send(()).is_ok() {
                held.holder = Some(waiter);
                return;
            }
        }
    }

    /// Who holds it now, for tests and the log.
    pub fn holder(&self) -> Option<String> {
        self.held.lock().expect("write lock").holder.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::time::Duration;

    async fn settle() {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    #[tokio::test]
    async fn the_first_writer_gets_it_and_asking_again_does_not_wait() {
        let lock = WriteLock::default();
        assert!(lock.acquire("a", Class::Person, &Cancel::new()).await);
        assert!(lock.acquire("a", Class::Person, &Cancel::new()).await);
        assert_eq!(lock.holder().as_deref(), Some("a"));
    }

    #[tokio::test]
    async fn a_person_goes_before_a_background_turn_that_asked_first() {
        let lock = Arc::new(WriteLock::default());
        assert!(lock.acquire("holder", Class::Person, &Cancel::new()).await);
        let order = Arc::new(Mutex::new(Vec::new()));
        let wait = |task: &'static str, class| {
            let (lock, order) = (Arc::clone(&lock), Arc::clone(&order));
            tokio::spawn(async move {
                assert!(lock.acquire(task, class, &Cancel::new()).await);
                order.lock().unwrap().push(task);
            })
        };
        let schedule = wait("schedule", Class::Background);
        settle().await;
        let first = wait("first", Class::Person);
        settle().await;
        let second = wait("second", Class::Person);
        settle().await;
        lock.release("holder");
        settle().await;
        lock.release("first");
        settle().await;
        lock.release("second");
        for handle in [schedule, first, second] {
            handle.await.unwrap();
        }
        assert_eq!(*order.lock().unwrap(), vec!["first", "second", "schedule"]);
    }

    #[tokio::test]
    async fn a_cancelled_wait_never_gets_the_lock_and_the_next_one_does() {
        let lock = Arc::new(WriteLock::default());
        assert!(lock.acquire("holder", Class::Person, &Cancel::new()).await);
        let cancel = Cancel::new();
        let stopped = {
            let (lock, cancel) = (Arc::clone(&lock), cancel.clone());
            tokio::spawn(async move { lock.acquire("stopped", Class::Person, &cancel).await })
        };
        settle().await;
        let next = {
            let lock = Arc::clone(&lock);
            tokio::spawn(async move {
                lock.acquire("next", Class::Background, &Cancel::new())
                    .await
            })
        };
        settle().await;
        cancel.cancel();
        assert!(!stopped.await.unwrap());
        lock.release("holder");
        assert!(next.await.unwrap());
        assert_eq!(lock.holder().as_deref(), Some("next"));
    }

    #[tokio::test]
    async fn releasing_a_lock_you_do_not_hold_changes_nothing() {
        let lock = WriteLock::default();
        assert!(lock.acquire("a", Class::Background, &Cancel::new()).await);
        lock.release("b");
        assert_eq!(lock.holder().as_deref(), Some("a"));
        lock.release("a");
        assert_eq!(lock.holder(), None);
    }
}
