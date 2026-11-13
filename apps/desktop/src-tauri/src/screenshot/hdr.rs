//! HDR screens. There the game's picture arrives as 16-bit floats (scRGB:
//! 1.0 is 80 nits, brighter than white goes above 1.0), but a JPEG only holds
//! normal (SDR) colors. The picture is brought down the standard way (ITU-R
//! BT.2390): what Windows shows as white becomes white, darker parts stay as
//! the game drew them, and brighter highlights are compressed instead of cut
//! off. An SDR game on an HDR screen comes back exactly as it was drawn.

/// scRGB 1.0, in nits.
const SCRGB_WHITE_NITS: f32 = 80.0;
/// Brightest a PQ signal goes, in nits.
const PQ_MAX_NITS: f64 = 10_000.0;
const PQ_M1: f64 = 2610.0 / 16384.0;
const PQ_M2: f64 = 2523.0 / 4096.0 * 128.0;
const PQ_C1: f64 = 3424.0 / 4096.0;
const PQ_C2: f64 = 2413.0 / 4096.0 * 32.0;
const PQ_C3: f64 = 2392.0 / 4096.0 * 32.0;
/// The brightest 0.1% may still end up plain white: a spark or the sun's disc
/// shouldn't darken everything else.
const PEAK_PERCENTILE: f64 = 0.999;
/// The brightest part is estimated from at most this many pixels.
const PEAK_SAMPLES: usize = 250_000;
/// Linear light becomes sRGB bytes through a table this big.
const SRGB_STEPS: usize = 16_384;

/// Reads one IEEE half float.
pub fn half_to_f32(bits: u16) -> f32 {
    let sign = if bits & 0x8000 == 0 { 1.0 } else { -1.0 };
    let exponent = i32::from((bits >> 10) & 0x1F);
    let fraction = f32::from(bits & 0x03FF);
    match exponent {
        0 => sign * fraction * 2f32.powi(-24),
        0x1F if fraction == 0.0 => sign * f32::INFINITY,
        0x1F => f32::NAN,
        _ => sign * (1.0 + fraction / 1024.0) * 2f32.powi(exponent - 15),
    }
}

/// Linear light (0 to 1) as an sRGB byte.
pub fn srgb_byte(linear: f32) -> u8 {
    if !(linear > 0.0) {
        return 0;
    }
    if linear >= 1.0 {
        return 255;
    }
    let encoded = if linear <= 0.003_130_8 {
        linear * 12.92
    } else {
        1.055 * linear.powf(1.0 / 2.4) - 0.055
    };
    (encoded * 255.0).round() as u8
}

/// Nits as a PQ signal (SMPTE ST 2084), 0 to 1.
pub fn pq_from_nits(nits: f32) -> f32 {
    pq(f64::from(nits)) as f32
}

/// A PQ signal as nits.
pub fn nits_from_pq(signal: f32) -> f32 {
    pq_nits(f64::from(signal)) as f32
}

fn pq(nits: f64) -> f64 {
    let light = (nits / PQ_MAX_NITS).clamp(0.0, 1.0).powf(PQ_M1);
    ((PQ_C1 + PQ_C2 * light) / (1.0 + PQ_C3 * light)).powf(PQ_M2)
}

fn pq_nits(signal: f64) -> f64 {
    let raised = signal.clamp(0.0, 1.0).powf(1.0 / PQ_M2);
    PQ_MAX_NITS * ((raised - PQ_C1).max(0.0) / (PQ_C2 - PQ_C3 * raised)).powf(1.0 / PQ_M1)
}

/// The BT.2390 curve for one picture: from its brightest part down to white.
struct Curve {
    /// None: the picture already fits and stays as it is.
    shape: Option<Shape>,
}

struct Shape {
    source_pq: f64,
    max_lum: f64,
    knee: f64,
    /// Below this brightness nothing changes, so most pixels skip the math.
    knee_nits: f32,
}

impl Curve {
    fn new(source_peak: f32, target_peak: f32) -> Self {
        if !(source_peak > target_peak) || !(target_peak > 0.0) {
            return Self { shape: None };
        }
        let source_pq = pq(f64::from(source_peak));
        let max_lum = pq(f64::from(target_peak)) / source_pq;
        let knee = 1.5 * max_lum - 0.5;
        Self {
            shape: Some(Shape {
                source_pq,
                max_lum,
                knee,
                knee_nits: pq_nits(knee.max(0.0) * source_pq) as f32,
            }),
        }
    }

    fn apply(&self, nits: f32) -> f32 {
        let Some(shape) = &self.shape else {
            return nits;
        };
        if nits <= shape.knee_nits {
            return nits;
        }
        let e1 = (pq(f64::from(nits)) / shape.source_pq).min(1.0);
        if e1 < shape.knee {
            return nits;
        }
        let t = (e1 - shape.knee) / (1.0 - shape.knee);
        let (t2, t3) = (t * t, t * t * t);
        let e2 = (2.0 * t3 - 3.0 * t2 + 1.0) * shape.knee
            + (t3 - 2.0 * t2 + t) * (1.0 - shape.knee)
            + (-2.0 * t3 + 3.0 * t2) * shape.max_lum;
        pq_nits(e2 * shape.source_pq) as f32
    }
}

/// The BT.2390 curve: brings `nits` from a picture whose brightest part is
/// `source_peak` into a range whose brightest is `target_peak`. Pictures that
/// already fit stay as they are.
pub fn eetf(nits: f32, source_peak: f32, target_peak: f32) -> f32 {
    if !(nits > 0.0) {
        return 0.0;
    }
    Curve::new(source_peak, target_peak).apply(nits)
}

fn half_table() -> &'static [f32] {
    static TABLE: std::sync::OnceLock<Vec<f32>> = std::sync::OnceLock::new();
    TABLE.get_or_init(|| (0..=u16::MAX).map(half_to_f32).collect())
}

fn srgb_table() -> &'static [u8] {
    static TABLE: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
    TABLE.get_or_init(|| {
        (0..SRGB_STEPS)
            .map(|step| srgb_byte(step as f32 / (SRGB_STEPS - 1) as f32))
            .collect()
    })
}

fn table_byte(table: &[u8], linear: f32) -> u8 {
    if !(linear > 0.0) {
        return 0;
    }
    table[(linear.min(1.0) * (SRGB_STEPS - 1) as f32).round() as usize]
}

/// The pixel's red, green and blue in nits. Negative, broken or impossible
/// values don't get through.
fn pixel_nits(pixels: &[u8], at: usize, halves: &[f32]) -> [f32; 3] {
    let channel = |offset: usize| {
        let Some(bytes) = pixels.get(at + offset..at + offset + 2) else {
            return 0.0;
        };
        let value = halves[usize::from(u16::from_le_bytes([bytes[0], bytes[1]]))];
        if value > 0.0 {
            (value * SCRGB_WHITE_NITS).min(PQ_MAX_NITS as f32)
        } else {
            0.0
        }
    };
    [channel(0), channel(2), channel(4)]
}

/// The pixel's alpha as a byte. Windows leaves rounded window corners
/// see-through; the corner fill looks for that.
fn pixel_alpha(pixels: &[u8], at: usize, halves: &[f32]) -> u8 {
    let Some(bytes) = pixels.get(at + 6..at + 8) else {
        return 255;
    };
    let alpha = halves[usize::from(u16::from_le_bytes([bytes[0], bytes[1]]))];
    if alpha >= 1.0 {
        255
    } else if alpha > 0.0 {
        (alpha * 255.0).round() as u8
    } else {
        0
    }
}

/// The brightness nearly all of the picture stays under, in nits.
fn frame_peak(pixels: &[u8], width: usize, height: usize, stride: usize, halves: &[f32]) -> f32 {
    let total = width * height;
    if total == 0 {
        return 0.0;
    }
    let step = (total / PEAK_SAMPLES).max(1);
    let mut brightest: Vec<f32> = (0..total)
        .step_by(step)
        .map(|index| {
            let at = (index / width) * stride + (index % width) * 8;
            let [red, green, blue] = pixel_nits(pixels, at, halves);
            red.max(green).max(blue)
        })
        .collect();
    let rank = ((brightest.len() as f64 * PEAK_PERCENTILE).ceil() as usize)
        .saturating_sub(1)
        .min(brightest.len() - 1);
    let (_, peak, _) = brightest.select_nth_unstable_by(rank, f32::total_cmp);
    *peak
}

/// An RGBA16F frame (`stride` bytes per row) as tight BGRA8. `sdr_white_nits`
/// is Windows' "SDR content brightness": the brightness that becomes white.
pub fn hdr_to_bgra(
    pixels: &[u8],
    width: u32,
    height: u32,
    stride: usize,
    sdr_white_nits: f32,
) -> Vec<u8> {
    let (width, height) = (width as usize, height as usize);
    let mut out = vec![0u8; width * height * 4];
    if width == 0 || height == 0 {
        return out;
    }
    let white = if sdr_white_nits.is_finite() && sdr_white_nits > 0.0 {
        sdr_white_nits
    } else {
        SCRGB_WHITE_NITS
    };
    let (halves, srgb) = (half_table(), srgb_table());
    let curve = Curve::new(frame_peak(pixels, width, height, stride, halves), white);
    let threads = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(1)
        .clamp(1, 8);
    let rows_per_thread = height.div_ceil(threads);
    std::thread::scope(|scope| {
        for (part, rows) in out.chunks_mut(rows_per_thread * width * 4).enumerate() {
            let curve = &curve;
            scope.spawn(move || {
                for (offset, row) in rows.chunks_mut(width * 4).enumerate() {
                    let y = part * rows_per_thread + offset;
                    for (x, target) in row.chunks_exact_mut(4).enumerate() {
                        let at = y * stride + x * 8;
                        let [red, green, blue] = pixel_nits(pixels, at, halves);
                        let brightest = red.max(green).max(blue);
                        // The channels scale together, so colors keep their hue.
                        let scale = if brightest > 0.0 {
                            curve.apply(brightest) / brightest / white
                        } else {
                            0.0
                        };
                        target.copy_from_slice(&[
                            table_byte(srgb, blue * scale),
                            table_byte(srgb, green * scale),
                            table_byte(srgb, red * scale),
                            pixel_alpha(pixels, at, halves),
                        ]);
                    }
                }
            });
        }
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One RGBA16F row from (r, g, b) half-float bit patterns.
    fn row(pixels: &[[u16; 3]]) -> Vec<u8> {
        pixels
            .iter()
            .flat_map(|[r, g, b]| [*r, *g, *b, 0x3C00])
            .flat_map(u16::to_le_bytes)
            .collect()
    }

    // Exact half floats used below.
    const H_0_5: u16 = 0x3800;
    const H_1_25: u16 = 0x3D00; // 100 nits
    const H_2_5: u16 = 0x4100; // 200 nits
    const H_5: u16 = 0x4500; // 400 nits
    const H_10: u16 = 0x4900; // 800 nits

    #[test]
    fn reads_half_floats() {
        assert_eq!(half_to_f32(0x0000), 0.0);
        assert_eq!(half_to_f32(0x3C00), 1.0);
        assert_eq!(half_to_f32(H_0_5), 0.5);
        assert_eq!(half_to_f32(H_2_5), 2.5);
        assert_eq!(half_to_f32(0xC000), -2.0);
        assert_eq!(half_to_f32(0x7BFF), 65504.0);
        assert!((half_to_f32(0x0001) - 5.960_464_5e-8).abs() < 1e-12);
        assert!(half_to_f32(0x7C00).is_infinite());
        assert!(half_to_f32(0x7E00).is_nan());
    }

    #[test]
    fn encodes_srgb_bytes() {
        assert_eq!(srgb_byte(0.0), 0);
        assert_eq!(srgb_byte(1.0), 255);
        assert_eq!(srgb_byte(0.5), 188);
        assert_eq!(srgb_byte(0.002), 7);
        assert_eq!(srgb_byte(-1.0), 0);
        assert_eq!(srgb_byte(7.0), 255);
        assert_eq!(srgb_byte(f32::NAN), 0);
    }

    #[test]
    fn converts_pq_both_ways() {
        assert!((pq_from_nits(10_000.0) - 1.0).abs() < 1e-5);
        assert!((pq_from_nits(100.0) - 0.508).abs() < 0.002);
        for nits in [0.1, 1.0, 80.0, 203.0, 1_000.0, 10_000.0] {
            let back = nits_from_pq(pq_from_nits(nits));
            assert!(
                (back - nits).abs() <= nits * 0.001 + 1e-4,
                "{nits} came back as {back}"
            );
        }
    }

    #[test]
    fn keeps_dark_and_middle_tones() {
        let out = eetf(10.0, 1_000.0, 200.0);
        assert!((out - 10.0).abs() < 0.01, "{out}");
    }

    #[test]
    fn brings_the_brightest_part_down_to_white() {
        let out = eetf(1_000.0, 1_000.0, 200.0);
        assert!((out - 200.0).abs() < 2.0, "{out}");
    }

    #[test]
    fn never_makes_brighter_parts_darker() {
        let mut last = 0.0;
        for step in 0..=250 {
            let out = eetf(step as f32 * 5.0, 1_000.0, 200.0);
            assert!(
                out + 1e-3 >= last,
                "{} nits gave {out} after {last}",
                step * 5
            );
            last = out;
        }
    }

    #[test]
    fn leaves_pictures_without_highlights_alone() {
        assert_eq!(eetf(150.0, 180.0, 200.0), 150.0);
    }

    #[test]
    fn brings_an_sdr_game_back_exactly() {
        // With "SDR content brightness" at 200 nits, Windows shows the game's
        // white at scRGB 2.5 and its middle grey (linear 0.5) at 1.25.
        let frame = row(&[[H_1_25, H_1_25, H_1_25], [H_2_5, H_2_5, H_2_5]]);
        let bgra = hdr_to_bgra(&frame, 2, 1, frame.len(), 200.0);
        assert_eq!(bgra, vec![188, 188, 188, 255, 255, 255, 255, 255]);
    }

    #[test]
    fn compresses_highlights_instead_of_cutting_them_off() {
        // Snow at 400 and 800 nits on a 200-nit white used to come out as
        // the same plain white.
        let frame = row(&[
            [H_5, H_5, H_5],
            [H_10, H_10, H_10],
            [H_1_25, H_1_25, H_1_25],
        ]);
        let bgra = hdr_to_bgra(&frame, 3, 1, frame.len(), 200.0);
        let (snow, brighter, grey) = (bgra[0], bgra[4], bgra[8]);
        assert!(snow < brighter, "{snow} {brighter}");
        assert!(grey >= 180, "{grey}");
    }

    #[test]
    fn keeps_colors_and_writes_blue_green_red() {
        // A red-orange highlight stays red-orange: channels scale together.
        let frame = row(&[[H_10, H_5, 0x0000], [H_0_5, H_0_5, H_0_5]]);
        let bgra = hdr_to_bgra(&frame, 2, 1, frame.len(), 80.0);
        let (blue, green, red, alpha) = (bgra[0], bgra[1], bgra[2], bgra[3]);
        assert_eq!((blue, alpha), (0, 255));
        assert!(red > green && green > 0, "{red} {green}");
    }

    #[test]
    fn keeps_see_through_pixels_see_through() {
        // Windows 11's rounded window corners: the corner fill finds them by
        // their missing alpha, in HDR too.
        let mut frame = row(&[[H_1_25, H_1_25, H_1_25]]);
        frame.extend([0u8; 8]);
        let bgra = hdr_to_bgra(&frame, 2, 1, frame.len(), 200.0);
        assert_eq!(bgra[3], 255);
        assert_eq!(&bgra[4..], &[0, 0, 0, 0]);
    }

    #[test]
    fn skips_the_padding_at_the_end_of_each_row() {
        let mut frame = row(&[[H_1_25, H_1_25, H_1_25]]);
        frame.extend([0xFF; 8]);
        frame.extend(row(&[[H_2_5, H_2_5, H_2_5]]));
        frame.extend([0xFF; 8]);
        let bgra = hdr_to_bgra(&frame, 1, 2, 16, 200.0);
        assert_eq!(bgra, vec![188, 188, 188, 255, 255, 255, 255, 255]);
    }
}
