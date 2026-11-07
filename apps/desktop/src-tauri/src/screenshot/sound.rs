//! Short sounds for the screenshot key, so it's clear even over a fullscreen
//! game: a camera click when the picture was saved, a low double tone when it
//! wasn't. Both are made in code, so there are no sound files to license.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Sound {
    Saved,
    Failed,
}

const SAMPLE_RATE: u32 = 44_100;

/// The sound as a 16-bit mono WAV file.
pub fn wav(sound: Sound) -> Vec<u8> {
    let mut samples = match sound {
        Sound::Saved => shutter(),
        Sound::Failed => failure(),
    };
    // Loud enough to hear over a game, never harsh.
    normalize(&mut samples, 0.45);
    encode(&samples)
}

fn samples_for(seconds: f32) -> usize {
    (seconds * SAMPLE_RATE as f32).round() as usize
}

/// A small fixed noise source: the same click every time.
struct Noise(u32);

impl Noise {
    fn next(&mut self) -> f32 {
        let mut value = self.0;
        value ^= value << 13;
        value ^= value >> 17;
        value ^= value << 5;
        self.0 = value;
        value as f32 / u32::MAX as f32 * 2.0 - 1.0
    }
}

/// A camera click: the shutter opening and, a moment later, closing. Each is
/// a short burst of soft noise over a low thump.
fn shutter() -> Vec<f32> {
    let mut out = vec![0.0f32; samples_for(0.16)];
    let mut noise = Noise(0x2545_F491);
    for (start, gain, brightness) in [(0.0, 1.0, 0.35), (0.065, 0.7, 0.55)] {
        let first = samples_for(start);
        let mut soft = 0.0f32;
        for index in 0..samples_for(0.035) {
            let time = index as f32 / SAMPLE_RATE as f32;
            soft += brightness * (noise.next() - soft);
            let thump = (std::f32::consts::TAU * 180.0 * time).sin() * (-time / 0.012).exp();
            let sample = soft * (-time / 0.004).exp() + 0.5 * thump;
            if let Some(slot) = out.get_mut(first + index) {
                *slot += gain * sample;
            }
        }
    }
    fade(&mut out, 0.002, 0.012);
    out
}

/// Two short falling tones: "that didn't work".
fn failure() -> Vec<f32> {
    let mut out = Vec::new();
    for (frequency, seconds) in [(520.0f32, 0.07f32), (330.0, 0.11)] {
        let mut tone: Vec<f32> = (0..samples_for(seconds))
            .map(|index| {
                let phase = std::f32::consts::TAU * frequency * index as f32 / SAMPLE_RATE as f32;
                phase.sin() + 0.25 * (2.0 * phase).sin()
            })
            .collect();
        fade(&mut tone, 0.006, 0.02);
        out.extend(tone);
        out.extend(std::iter::repeat_n(0.0, samples_for(0.03)));
    }
    out
}

/// Raised-cosine fades at both ends, so the sound starts and stops softly.
fn fade(samples: &mut [f32], fade_in: f32, fade_out: f32) {
    let length = samples.len();
    let rise = samples_for(fade_in).min(length);
    let fall = samples_for(fade_out).min(length);
    for index in 0..rise {
        samples[index] *= 0.5 - 0.5 * (std::f32::consts::PI * index as f32 / rise as f32).cos();
    }
    for index in 0..fall {
        samples[length - 1 - index] *=
            0.5 - 0.5 * (std::f32::consts::PI * index as f32 / fall as f32).cos();
    }
}

fn normalize(samples: &mut [f32], peak: f32) {
    let loudest = samples
        .iter()
        .fold(0.0f32, |most, sample| most.max(sample.abs()));
    if loudest > 0.0 {
        let gain = peak / loudest;
        samples.iter_mut().for_each(|sample| *sample *= gain);
    }
}

fn encode(samples: &[f32]) -> Vec<u8> {
    let data_bytes = (samples.len() * 2) as u32;
    let mut bytes = Vec::with_capacity(44 + samples.len() * 2);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_bytes).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    bytes.extend_from_slice(&(SAMPLE_RATE * 2).to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_bytes.to_le_bytes());
    for sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * f32::from(i16::MAX)).round() as i16;
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

/// Plays the sound without waiting for it. Silent when Windows can't play.
pub fn play(sound: Sound) {
    #[cfg(windows)]
    {
        use std::sync::OnceLock;
        use windows::{
            core::PCWSTR,
            Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_MEMORY, SND_NODEFAULT},
        };
        // Windows reads the sound from this memory while it plays, so it
        // stays for as long as the app runs.
        static SAVED: OnceLock<Vec<u8>> = OnceLock::new();
        static FAILED: OnceLock<Vec<u8>> = OnceLock::new();
        let bytes = match sound {
            Sound::Saved => SAVED.get_or_init(|| wav(Sound::Saved)),
            Sound::Failed => FAILED.get_or_init(|| wav(Sound::Failed)),
        };
        unsafe {
            let _ = PlaySoundW(
                PCWSTR(bytes.as_ptr().cast()),
                None,
                SND_MEMORY | SND_ASYNC | SND_NODEFAULT,
            );
        }
    }
    #[cfg(not(windows))]
    let _ = sound;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u16_at(bytes: &[u8], at: usize) -> u16 {
        u16::from_le_bytes([bytes[at], bytes[at + 1]])
    }

    fn u32_at(bytes: &[u8], at: usize) -> u32 {
        u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
    }

    fn samples(bytes: &[u8]) -> Vec<i16> {
        bytes[44..]
            .chunks_exact(2)
            .map(|pair| i16::from_le_bytes([pair[0], pair[1]]))
            .collect()
    }

    #[test]
    fn writes_a_wav_file_windows_can_play() {
        for sound in [Sound::Saved, Sound::Failed] {
            let bytes = wav(sound);
            assert!(bytes.len() > 44, "{sound:?}");
            assert_eq!(&bytes[0..4], b"RIFF");
            assert_eq!(u32_at(&bytes, 4) as usize, bytes.len() - 8);
            assert_eq!(&bytes[8..16], b"WAVEfmt ");
            assert_eq!(u32_at(&bytes, 16), 16);
            assert_eq!(u16_at(&bytes, 20), 1, "PCM");
            assert_eq!(u16_at(&bytes, 22), 1, "mono");
            assert_eq!(u32_at(&bytes, 24), SAMPLE_RATE);
            assert_eq!(u32_at(&bytes, 28), SAMPLE_RATE * 2);
            assert_eq!(u16_at(&bytes, 32), 2);
            assert_eq!(u16_at(&bytes, 34), 16);
            assert_eq!(&bytes[36..40], b"data");
            assert_eq!(u32_at(&bytes, 40) as usize, bytes.len() - 44);
        }
    }

    #[test]
    fn stays_short() {
        let seconds = |sound| samples(&wav(sound)).len() as f32 / SAMPLE_RATE as f32;
        let click = seconds(Sound::Saved);
        let failure = seconds(Sound::Failed);
        assert!((0.08..=0.25).contains(&click), "{click}");
        assert!((0.15..=0.4).contains(&failure), "{failure}");
    }

    #[test]
    fn is_not_too_loud_and_not_silent() {
        for sound in [Sound::Saved, Sound::Failed] {
            let peak = samples(&wav(sound))
                .iter()
                .map(|sample| sample.unsigned_abs())
                .max()
                .unwrap_or(0);
            assert!(peak > 3_000, "{sound:?} {peak}");
            assert!(peak <= i16::MAX as u16 / 2, "{sound:?} {peak}");
        }
    }

    #[test]
    fn sounds_the_same_every_time_and_different_from_the_other() {
        assert_eq!(wav(Sound::Saved), wav(Sound::Saved));
        assert_ne!(wav(Sound::Saved), wav(Sound::Failed));
    }

    #[test]
    fn starts_and_ends_quietly() {
        // No click from a jump at the start or the end.
        for sound in [Sound::Saved, Sound::Failed] {
            let all = samples(&wav(sound));
            let last = *all.last().unwrap();
            assert!(last.unsigned_abs() < 200, "{sound:?} ends at {last}");
        }
    }
}
