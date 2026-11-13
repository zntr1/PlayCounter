//! Screenshots of the game you're playing: saved to Pictures\PlayCounter and
//! shown on the session they were taken in (docs/memory-book-plan.md).

pub mod caption;
mod capture;
pub mod commands;
mod files;
pub mod hdr;
pub mod sound;

pub use capture::*;
