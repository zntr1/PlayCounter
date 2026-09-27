// PlayStation pads are not XInput devices, so controller navigation reads their
// HID input reports directly and translates them into the XInput button layout
// the ControllerMachine already understands. PlayCounter only reads: it never
// sends anything to the pad, so Steam, DS4Windows and games keep their control.

use crate::controller::{
    ControllerKind, BUTTON_A, BUTTON_B, BUTTON_DPAD_DOWN, BUTTON_DPAD_LEFT, BUTTON_DPAD_RIGHT,
    BUTTON_DPAD_UP, BUTTON_RIGHT_SHOULDER, BUTTON_VIEW,
};

pub const SONY_VENDOR_ID: u16 = 0x054c;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PadModel {
    DualSense,
    DualShock4,
    // The Sony USB wireless adapter for the DualShock 4 keeps sending reports
    // while no pad is paired to it.
    DualShock4Adapter,
}

impl PadModel {
    pub fn from_ids(vendor_id: u16, product_id: u16) -> Option<Self> {
        if vendor_id != SONY_VENDOR_ID {
            return None;
        }
        match product_id {
            0x0ce6 | 0x0df2 => Some(Self::DualSense),
            0x05c4 | 0x09cc => Some(Self::DualShock4),
            0x0ba0 => Some(Self::DualShock4Adapter),
            _ => None,
        }
    }

    pub fn kind(self) -> ControllerKind {
        match self {
            Self::DualSense => ControllerKind::Ps5,
            Self::DualShock4 | Self::DualShock4Adapter => ControllerKind::Ps4,
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct PadState {
    pub buttons: u16,
    pub stick: (i16, i16),
    pub right_stick_y: i16,
}

const CROSS: u8 = 0x20;
const CIRCLE: u8 = 0x40;
const R1: u8 = 0x02;
const CREATE_OR_SHARE: u8 = 0x10;
const ADAPTER_STATUS_BYTE: usize = 31;
const ADAPTER_PAD_DISCONNECTED: u8 = 0x04;

// Layouts follow the Linux hid-playstation driver and SDL's PS5 driver. Byte 0
// is the report id. Windows pads Bluetooth reports to the longest report the
// pad declares, which is why the DualSense simple report can arrive as 78 bytes.
pub fn parse_report(model: PadModel, data: &[u8]) -> Option<PadState> {
    let (sticks_at, buttons_at) = match (model, *data.first()?, data.len()) {
        // Bluetooth simple report, sent until something switches the pad to
        // full reports.
        (PadModel::DualSense, 0x01, 10 | 78) => (1, 5),
        (PadModel::DualSense, 0x01, _) => (1, 8),
        (PadModel::DualSense, 0x31, _) => (2, 9),
        (PadModel::DualShock4Adapter, 0x01, _)
            if data.get(ADAPTER_STATUS_BYTE)? & ADAPTER_PAD_DISCONNECTED != 0 =>
        {
            return Some(PadState::default());
        }
        (PadModel::DualShock4 | PadModel::DualShock4Adapter, 0x01, _) => (1, 5),
        (PadModel::DualShock4 | PadModel::DualShock4Adapter, 0x11, _) => (3, 7),
        _ => return None,
    };
    let sticks = data.get(sticks_at..sticks_at + 4)?;
    let buttons0 = *data.get(buttons_at)?;
    let buttons1 = *data.get(buttons_at + 1)?;

    // The hat counts clockwise from 0 = up; 8 means released.
    let hat = buttons0 & 0x0f;
    let mut buttons = 0;
    if matches!(hat, 7 | 0 | 1) {
        buttons |= BUTTON_DPAD_UP;
    }
    if matches!(hat, 1..=3) {
        buttons |= BUTTON_DPAD_RIGHT;
    }
    if matches!(hat, 3..=5) {
        buttons |= BUTTON_DPAD_DOWN;
    }
    if matches!(hat, 5..=7) {
        buttons |= BUTTON_DPAD_LEFT;
    }
    if buttons0 & CROSS != 0 {
        buttons |= BUTTON_A;
    }
    if buttons0 & CIRCLE != 0 {
        buttons |= BUTTON_B;
    }
    if buttons1 & R1 != 0 {
        buttons |= BUTTON_RIGHT_SHOULDER;
    }
    if buttons1 & CREATE_OR_SHARE != 0 {
        buttons |= BUTTON_VIEW;
    }

    Some(PadState {
        buttons,
        stick: (axis(sticks[0]), axis_up(sticks[1])),
        right_stick_y: axis_up(sticks[3]),
    })
}

// Pad axes run 0..=255 with 128 as center. XInput uses i16 with up positive.
fn axis(raw: u8) -> i16 {
    ((i32::from(raw) - 128) * 256).clamp(i16::MIN.into(), i16::MAX.into()) as i16
}

fn axis_up(raw: u8) -> i16 {
    ((128 - i32::from(raw)) * 256).clamp(i16::MIN.into(), i16::MAX.into()) as i16
}

#[cfg(windows)]
pub use windows_pads::PlaystationPads;

#[cfg(windows)]
mod windows_pads {
    use super::{parse_report, PadModel, PadState, SONY_VENDOR_ID};
    use crate::controller::{ControllerAction, ControllerKind, ControllerMachine};
    use hidapi::{HidApi, HidDevice, HidResult};
    use std::ffi::CString;

    const PROBE_MS: u64 = 2_000;
    // A pad sends a few hundred reports a second. The cap only guards against a
    // device that never runs dry.
    const MAX_REPORTS_PER_TICK: usize = 64;

    struct OpenPad {
        path: CString,
        device: HidDevice,
        model: PadModel,
        source: usize,
        state: PadState,
        machine: ControllerMachine,
    }

    impl OpenPad {
        // Drains everything queued since the last tick and keeps the newest
        // report, so input never lags behind the pad.
        fn read_latest(&self) -> HidResult<Option<PadState>> {
            let mut buf = [0_u8; 128];
            let mut latest = None;
            for _ in 0..MAX_REPORTS_PER_TICK {
                let len = self.device.read(&mut buf)?;
                if len == 0 {
                    break;
                }
                if let Some(state) = parse_report(self.model, &buf[..len]) {
                    latest = Some(state);
                }
            }
            Ok(latest)
        }
    }

    pub struct PlaystationPads {
        api: Option<HidApi>,
        pads: Vec<OpenPad>,
        next_probe_at: u64,
        next_source: usize,
    }

    impl PlaystationPads {
        pub fn new(first_source: usize) -> Self {
            Self {
                api: None,
                pads: Vec::new(),
                next_probe_at: 0,
                next_source: first_source,
            }
        }

        pub fn poll(&mut self, now_ms: u64) -> Vec<(usize, ControllerKind, Vec<ControllerAction>)> {
            if now_ms >= self.next_probe_at {
                self.next_probe_at = now_ms + PROBE_MS;
                self.open_new_pads();
            }
            let mut fired = Vec::new();
            // A read error means the pad went away. Dropping it also drops its
            // held buttons; the next probe opens it again when it is back.
            self.pads.retain_mut(|pad| {
                let Ok(latest) = pad.read_latest() else {
                    return false;
                };
                if let Some(state) = latest {
                    pad.state = state;
                }
                let actions = pad.machine.update(
                    pad.state.buttons,
                    pad.state.stick,
                    pad.state.right_stick_y,
                    now_ms,
                );
                if !actions.is_empty() {
                    fired.push((pad.source, pad.model.kind(), actions));
                }
                true
            });
            fired
        }

        fn open_new_pads(&mut self) {
            if self.api.is_none() {
                self.api = HidApi::new().ok();
            }
            let Some(api) = self.api.as_mut() else {
                return;
            };
            if api.reset_devices().is_err() || api.add_devices(SONY_VENDOR_ID, 0).is_err() {
                return;
            }
            for info in api.device_list() {
                let Some(model) = PadModel::from_ids(info.vendor_id(), info.product_id()) else {
                    continue;
                };
                if self
                    .pads
                    .iter()
                    .any(|pad| pad.path.as_c_str() == info.path())
                {
                    continue;
                }
                let Ok(device) = api.open_path(info.path()) else {
                    continue;
                };
                if device.set_blocking_mode(false).is_err() {
                    continue;
                }
                self.pads.push(OpenPad {
                    path: info.path().to_owned(),
                    device,
                    model,
                    source: self.next_source,
                    state: PadState::default(),
                    machine: ControllerMachine::default(),
                });
                self.next_source += 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NEUTRAL_STICKS: [u8; 4] = [128, 128, 128, 128];
    const HAT_RELEASED: u8 = 0x08;

    fn report(
        id: u8,
        len: usize,
        sticks_at: usize,
        buttons_at: usize,
        buttons: [u8; 2],
    ) -> Vec<u8> {
        let mut data = vec![0_u8; len];
        data[0] = id;
        data[sticks_at..sticks_at + 4].copy_from_slice(&NEUTRAL_STICKS);
        data[buttons_at] = buttons[0];
        data[buttons_at + 1] = buttons[1];
        data
    }

    fn cross_and_r1() -> [u8; 2] {
        [HAT_RELEASED | CROSS, R1]
    }

    fn expected_cross_and_r1() -> PadState {
        PadState {
            buttons: BUTTON_A | BUTTON_RIGHT_SHOULDER,
            ..PadState::default()
        }
    }

    #[test]
    fn recognizes_only_sony_playstation_pads() {
        assert_eq!(
            PadModel::from_ids(0x054c, 0x0ce6),
            Some(PadModel::DualSense)
        );
        assert_eq!(
            PadModel::from_ids(0x054c, 0x0df2),
            Some(PadModel::DualSense)
        );
        assert_eq!(
            PadModel::from_ids(0x054c, 0x05c4),
            Some(PadModel::DualShock4)
        );
        assert_eq!(
            PadModel::from_ids(0x054c, 0x09cc),
            Some(PadModel::DualShock4)
        );
        assert_eq!(
            PadModel::from_ids(0x054c, 0x0ba0),
            Some(PadModel::DualShock4Adapter)
        );
        assert_eq!(PadModel::from_ids(0x045e, 0x0ce6), None);
        assert_eq!(PadModel::from_ids(0x054c, 0x0268), None);
        assert_eq!(PadModel::DualSense.kind(), ControllerKind::Ps5);
        assert_eq!(PadModel::DualShock4Adapter.kind(), ControllerKind::Ps4);
    }

    #[test]
    fn reads_every_dualsense_report_layout() {
        for data in [
            report(0x01, 64, 1, 8, cross_and_r1()),
            report(0x31, 78, 2, 9, cross_and_r1()),
            report(0x01, 10, 1, 5, cross_and_r1()),
            report(0x01, 78, 1, 5, cross_and_r1()),
        ] {
            assert_eq!(
                parse_report(PadModel::DualSense, &data),
                Some(expected_cross_and_r1()),
                "report {:#04x} with {} bytes",
                data[0],
                data.len()
            );
        }
    }

    #[test]
    fn reads_every_dualshock4_report_layout() {
        for (model, data) in [
            (PadModel::DualShock4, report(0x01, 64, 1, 5, cross_and_r1())),
            (PadModel::DualShock4, report(0x01, 10, 1, 5, cross_and_r1())),
            (PadModel::DualShock4, report(0x11, 78, 3, 7, cross_and_r1())),
            (
                PadModel::DualShock4Adapter,
                report(0x01, 64, 1, 5, cross_and_r1()),
            ),
        ] {
            assert_eq!(
                parse_report(model, &data),
                Some(expected_cross_and_r1()),
                "{model:?} report {:#04x}",
                data[0]
            );
        }
    }

    #[test]
    fn an_adapter_without_a_paired_pad_reads_as_released() {
        // Mostly zeros: taken at face value the sticks would sit fully up-left.
        let mut data = vec![0_u8; 64];
        data[0] = 0x01;
        data[ADAPTER_STATUS_BYTE] = ADAPTER_PAD_DISCONNECTED;
        assert_eq!(
            parse_report(PadModel::DualShock4Adapter, &data),
            Some(PadState::default())
        );
    }

    #[test]
    fn maps_circle_create_and_share_to_back_and_view() {
        let data = report(0x01, 64, 1, 8, [HAT_RELEASED | CIRCLE, CREATE_OR_SHARE]);
        assert_eq!(
            parse_report(PadModel::DualSense, &data).map(|state| state.buttons),
            Some(BUTTON_B | BUTTON_VIEW)
        );
        let data = report(0x11, 78, 3, 7, [HAT_RELEASED | CIRCLE, CREATE_OR_SHARE]);
        assert_eq!(
            parse_report(PadModel::DualShock4, &data).map(|state| state.buttons),
            Some(BUTTON_B | BUTTON_VIEW)
        );
    }

    #[test]
    fn hat_positions_cover_diagonals() {
        let cases = [
            (0, BUTTON_DPAD_UP),
            (1, BUTTON_DPAD_UP | BUTTON_DPAD_RIGHT),
            (2, BUTTON_DPAD_RIGHT),
            (3, BUTTON_DPAD_DOWN | BUTTON_DPAD_RIGHT),
            (4, BUTTON_DPAD_DOWN),
            (5, BUTTON_DPAD_DOWN | BUTTON_DPAD_LEFT),
            (6, BUTTON_DPAD_LEFT),
            (7, BUTTON_DPAD_UP | BUTTON_DPAD_LEFT),
            (8, 0),
        ];
        for (hat, expected) in cases {
            let data = report(0x01, 64, 1, 8, [hat, 0]);
            assert_eq!(
                parse_report(PadModel::DualSense, &data).map(|state| state.buttons),
                Some(expected),
                "hat {hat}"
            );
        }
    }

    #[test]
    fn sticks_convert_to_xinput_range_with_up_positive() {
        let mut data = report(0x01, 64, 1, 8, [HAT_RELEASED, 0]);
        data[1..5].copy_from_slice(&[255, 0, 128, 255]);
        let state = parse_report(PadModel::DualSense, &data).unwrap();
        assert_eq!(state.stick, (32_512, i16::MAX));
        assert_eq!(state.right_stick_y, -32_512);

        data[1..5].copy_from_slice(&[0, 255, 128, 0]);
        let state = parse_report(PadModel::DualSense, &data).unwrap();
        assert_eq!(state.stick, (i16::MIN, -32_512));
        assert_eq!(state.right_stick_y, i16::MAX);
    }

    #[test]
    fn ignores_other_and_truncated_reports() {
        assert_eq!(parse_report(PadModel::DualSense, &[]), None);
        assert_eq!(parse_report(PadModel::DualSense, &[0x05, 0, 0]), None);
        assert_eq!(parse_report(PadModel::DualShock4, &[0x31; 78]), None);
        assert_eq!(
            parse_report(PadModel::DualSense, &[0x31, 0, 128, 128]),
            None
        );
    }
}
