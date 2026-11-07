//! One frame of one game window, taken with Windows Graphics Capture: nothing
//! is injected into the game. Only the window's own pixels end up in the
//! picture, so PlayCounter's popups and the live timer never do. True
//! exclusive-fullscreen games usually come back black; callers check
//! `looks_black` (docs/memory-book-plan.md, Part 1).

/// A rectangle in physical pixels. Left and top are inside it, right and
/// bottom are not.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PixelRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl PixelRect {
    pub fn width(&self) -> i32 {
        self.right - self.left
    }

    pub fn height(&self) -> i32 {
        self.bottom - self.top
    }
}

/// From this share of exactly black pixels on, a picture counts as black:
/// what Windows hands back when it can't see the game. Dark scenes, a black
/// sky and letterbox bars stay well below it.
pub const BLACK_SHARE_LIMIT: f64 = 0.999;

/// The share of sampled pixels whose blue, green and red are all 0. `pixels`
/// is BGRA with `stride` bytes per row. Alpha doesn't count: games rarely
/// write it.
pub fn black_share(pixels: &[u8], width: u32, height: u32, stride: usize) -> f64 {
    // Every 7th pixel: enough for a 4K picture in a few milliseconds, and a
    // prime step doesn't line up with stripes or tiles.
    const STEP: usize = 7;
    let (width, height) = (width as usize, height as usize);
    let total = width * height;
    let (mut sampled, mut black) = (0usize, 0usize);
    let mut index = 0;
    while index < total {
        let at = (index / width) * stride + (index % width) * 4;
        if let Some(pixel) = pixels.get(at..at + 3) {
            sampled += 1;
            if pixel == [0, 0, 0] {
                black += 1;
            }
        }
        index += STEP;
    }
    if sampled == 0 {
        return 1.0;
    }
    black as f64 / sampled as f64
}

pub fn looks_black(pixels: &[u8], width: u32, height: u32, stride: usize) -> bool {
    black_share(pixels, width, height, stride) >= BLACK_SHARE_LIMIT
}

/// Where the client area (the game's picture, without title bar and borders)
/// sits inside a captured window frame, in frame pixels. `frame_origin` is the
/// screen position of the frame's top-left pixel (the window's visible
/// bounds); `client` is the client area on the screen. None when no part of
/// the client area is in the frame.
pub fn client_crop(
    frame_origin: (i32, i32),
    frame_size: (u32, u32),
    client: PixelRect,
) -> Option<PixelRect> {
    let width = i32::try_from(frame_size.0).unwrap_or(i32::MAX);
    let height = i32::try_from(frame_size.1).unwrap_or(i32::MAX);
    let crop = PixelRect {
        left: (client.left - frame_origin.0).clamp(0, width),
        top: (client.top - frame_origin.1).clamp(0, height),
        right: (client.right - frame_origin.0).clamp(0, width),
        bottom: (client.bottom - frame_origin.1).clamp(0, height),
    };
    (crop.width() > 0 && crop.height() > 0).then_some(crop)
}

/// The pixels inside `crop`, as tight BGRA rows.
pub fn crop_bgra(pixels: &[u8], stride: usize, crop: PixelRect) -> Vec<u8> {
    crop_pixels(pixels, stride, crop, 4)
}

/// The pixels inside `crop` as tight rows, for any pixel size (4 bytes for
/// BGRA, 8 for the half floats of an HDR screen).
pub fn crop_pixels(pixels: &[u8], stride: usize, crop: PixelRect, pixel_bytes: usize) -> Vec<u8> {
    let row_bytes = crop.width().max(0) as usize * pixel_bytes;
    let mut cropped = Vec::with_capacity(row_bytes * crop.height().max(0) as usize);
    for y in crop.top.max(0)..crop.bottom.max(0) {
        let start = y as usize * stride + crop.left.max(0) as usize * pixel_bytes;
        match pixels.get(start..start + row_bytes) {
            Some(row) => cropped.extend_from_slice(row),
            None => break,
        }
    }
    cropped
}

/// Windows 11 rounds the corners of windows that aren't maximized or
/// fullscreen, and those few pixels come back black and see-through. Each one
/// takes the color of the nearest opaque pixel towards the middle. Pictures
/// without opaque pixels (some games write no alpha) stay as they are.
pub fn fill_rounded_corners(pixels: &mut [u8], width: u32, height: u32) {
    // Windows 11's corner radius is 8 px at 100%; 16 covers 200% scaling.
    const SIZE: i64 = 16;
    let (width, height) = (i64::from(width), i64::from(height));
    if width < SIZE * 2 || height < SIZE * 2 || pixels.len() < (width * height * 4) as usize {
        return;
    }
    let at = |x: i64, y: i64| ((y * width + x) * 4) as usize;
    for (corner_x, corner_y, step_x, step_y) in [
        (0, 0, 1, 1),
        (width - 1, 0, -1, 1),
        (0, height - 1, 1, -1),
        (width - 1, height - 1, -1, -1),
    ] {
        for dy in 0..SIZE {
            for dx in 0..SIZE {
                let (x, y) = (corner_x + dx * step_x, corner_y + dy * step_y);
                if pixels[at(x, y) + 3] == 255 {
                    continue;
                }
                // Walk diagonally towards the middle to the first opaque pixel.
                let source = (1..SIZE * 2)
                    .map(|step| (x + step * step_x, y + step * step_y))
                    .take_while(|&(x, y)| x >= 0 && y >= 0 && x < width && y < height)
                    .map(|(x, y)| at(x, y))
                    .find(|&source| pixels[source + 3] == 255);
                if let Some(source) = source {
                    let target = at(x, y);
                    pixels.copy_within(source..source + 4, target);
                }
            }
        }
    }
}

/// A captured picture: tight BGRA rows, alpha meaningless.
pub struct Picture {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
}

/// What a capture did, for the log and for messages.
#[derive(Clone, Debug, Default)]
pub struct CaptureInfo {
    /// The whole window as Windows captured it, title bar included.
    pub frame_width: u32,
    pub frame_height: u32,
    /// The game's picture inside that frame.
    pub crop: Option<PixelRect>,
    pub cursor_hidden: bool,
    /// Windows accepted "no yellow border" for this capture. Whether it
    /// listens depends on the build and on the user's consent.
    pub border_off_accepted: bool,
    /// The screen was in HDR mode and PlayCounter brought the picture down.
    pub hdr: bool,
    /// Windows' "SDR content brightness" used for that, in nits.
    pub sdr_white_nits: Option<f32>,
    /// Making the graphics device for this picture.
    pub device_ms: f64,
    pub item_ms: f64,
    pub first_frame_ms: f64,
    pub copy_ms: f64,
}

/// What `capture_window` says when the window is minimized.
pub const MINIMIZED: &str = "The window is minimized.";

/// How to read the window's colors.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CaptureMode {
    /// On an HDR screen, the full HDR picture, brought down by PlayCounter.
    Auto,
    /// Always Windows' own 8-bit picture, where HDR highlights are cut off.
    /// For comparing.
    Sdr,
}

/// A capture that runs while the caller does something else.
pub struct PendingCapture(std::sync::mpsc::Receiver<Result<(Picture, CaptureInfo), String>>);

impl PendingCapture {
    pub fn wait(self, timeout: std::time::Duration) -> Result<(Picture, CaptureInfo), String> {
        self.0
            .recv_timeout(timeout)
            .map_err(|_| "The capture took too long.".to_string())?
    }
}

/// How long a capture may take before it counts as failed.
pub const CAPTURE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(4);

/// One frame of the window with this raw HWND, cropped to its client area.
/// Can be called from any thread.
pub fn capture_window(hwnd: isize) -> Result<(Picture, CaptureInfo), String> {
    capture_window_as(hwnd, CaptureMode::Auto)
}

pub fn capture_window_as(hwnd: isize, mode: CaptureMode) -> Result<(Picture, CaptureInfo), String> {
    start_capture(hwnd, mode).wait(CAPTURE_TIMEOUT)
}

/// Starts a capture now and lets the caller collect it later.
pub fn start_capture(hwnd: isize, mode: CaptureMode) -> PendingCapture {
    imp::start_capture(hwnd, mode)
}

/// Writes the picture as a JPEG. `quality` is 0.0 to 1.0. Returns the size in
/// bytes.
pub fn save_jpeg(picture: &Picture, path: &std::path::Path, quality: f32) -> Result<u64, String> {
    imp::save_jpeg(picture, path, None, quality)
}

/// Writes a smaller copy (at most `max_width` wide) as a JPEG, for lists.
pub fn save_preview(
    picture: &Picture,
    path: &std::path::Path,
    max_width: u32,
    quality: f32,
) -> Result<u64, String> {
    imp::save_jpeg(picture, path, Some(max_width), quality)
}

/// Reads a picture file (JPEG, PNG, WebP) and writes a smaller copy as a
/// JPEG, for pictures that have no preview yet.
pub fn save_preview_from_file(
    source: &std::path::Path,
    path: &std::path::Path,
    max_width: u32,
    quality: f32,
) -> Result<u64, String> {
    imp::save_preview_from_file(source, path, max_width, quality)
}

/// Asks Windows once to capture without the yellow border. The answer as
/// text: Allowed, DeniedByUser, … or why it couldn't be asked.
pub fn request_borderless_capture() -> String {
    imp::request_borderless_capture()
}

/// Whether the monitor showing this window is in HDR mode. None if unknown.
pub fn monitor_is_hdr(hwnd: isize) -> Option<bool> {
    imp::monitor_is_hdr(hwnd)
}

#[cfg(not(windows))]
mod imp {
    use super::*;

    const UNSUPPORTED: &str = "Screenshots are not supported on this platform.";

    pub fn start_capture(_hwnd: isize, _mode: CaptureMode) -> PendingCapture {
        let (reply, receiver) = std::sync::mpsc::channel();
        let _ = reply.send(Err(UNSUPPORTED.into()));
        PendingCapture(receiver)
    }

    pub fn save_jpeg(
        _picture: &Picture,
        _path: &std::path::Path,
        _max_width: Option<u32>,
        _quality: f32,
    ) -> Result<u64, String> {
        Err(UNSUPPORTED.into())
    }

    pub fn save_preview_from_file(
        _source: &std::path::Path,
        _path: &std::path::Path,
        _max_width: u32,
        _quality: f32,
    ) -> Result<u64, String> {
        Err(UNSUPPORTED.into())
    }

    pub fn request_borderless_capture() -> String {
        UNSUPPORTED.into()
    }

    pub fn monitor_is_hdr(_hwnd: isize) -> Option<bool> {
        None
    }
}

#[cfg(windows)]
mod imp {
    use super::*;
    use std::{
        path::Path,
        sync::{mpsc, Mutex, OnceLock},
        time::{Duration, Instant},
    };
    use windows::{
        core::{Interface, HSTRING, PWSTR},
        Foundation::TypedEventHandler,
        Graphics::{
            Capture::{
                Direct3D11CaptureFrame, Direct3D11CaptureFramePool, GraphicsCaptureAccess,
                GraphicsCaptureAccessKind, GraphicsCaptureItem,
            },
            DirectX::{Direct3D11::IDirect3DDevice, DirectXPixelFormat},
        },
        Win32::{
            Devices::Display::{
                DisplayConfigGetDeviceInfo, GetDisplayConfigBufferSizes, QueryDisplayConfig,
                DISPLAYCONFIG_DEVICE_INFO_GET_SDR_WHITE_LEVEL,
                DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, DISPLAYCONFIG_DEVICE_INFO_HEADER,
                DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_PATH_INFO, DISPLAYCONFIG_SDR_WHITE_LEVEL,
                DISPLAYCONFIG_SOURCE_DEVICE_NAME, QDC_ONLY_ACTIVE_PATHS,
            },
            Foundation::{ERROR_SUCCESS, GENERIC_READ, GENERIC_WRITE, HMODULE, HWND, POINT, RECT},
            Graphics::{
                Direct3D::D3D_DRIVER_TYPE_HARDWARE,
                Direct3D11::{
                    D3D11CreateDevice, ID3D11Device, ID3D11Texture2D, D3D11_CPU_ACCESS_READ,
                    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ,
                    D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
                },
                Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS},
                Dxgi::{
                    Common::DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020, CreateDXGIFactory1,
                    IDXGIDevice, IDXGIFactory1, IDXGIOutput6,
                },
                Gdi::{
                    ClientToScreen, GetMonitorInfoW, MonitorFromWindow, MONITORINFOEXW,
                    MONITOR_DEFAULTTONEAREST,
                },
                Imaging::{
                    CLSID_WICImagingFactory, GUID_ContainerFormatJpeg, GUID_WICPixelFormat24bppBGR,
                    GUID_WICPixelFormat32bppBGR, IWICBitmapSource, IWICImagingFactory,
                    WICBitmapDitherTypeNone, WICBitmapEncoderNoCache,
                    WICBitmapInterpolationModeFant, WICBitmapPaletteTypeCustom,
                    WICDecodeMetadataCacheOnDemand,
                },
            },
            System::{
                Com::{
                    CoCreateInstance, CoInitializeEx, CoUninitialize, StructuredStorage::PROPBAG2,
                    CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
                },
                Variant::{VARIANT, VARIANT_0, VARIANT_0_0, VARIANT_0_0_0, VT_R4},
                WinRT::{
                    Direct3D11::{
                        CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
                    },
                    Graphics::Capture::IGraphicsCaptureItemInterop,
                },
            },
            UI::WindowsAndMessaging::{GetClientRect, IsIconic, IsWindow},
        },
    };

    /// How long to wait for Windows to hand over the first frame.
    const FRAME_TIMEOUT: Duration = Duration::from_secs(2);

    fn text(error: windows::core::Error) -> String {
        error.message()
    }

    fn ms(since: Instant) -> f64 {
        since.elapsed().as_secs_f64() * 1000.0
    }

    /// Runs `work` on a new thread with COM in the multithreaded apartment,
    /// which WinRT capture and WIC need.
    fn on_com_thread<T: Send>(
        work: impl FnOnce() -> Result<T, String> + Send,
    ) -> Result<T, String> {
        std::thread::scope(|scope| {
            scope
                .spawn(|| {
                    let initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok();
                    let result = work();
                    if initialized {
                        unsafe { CoUninitialize() };
                    }
                    result
                })
                .join()
                .unwrap_or_else(|_| Err("The screenshot thread stopped.".into()))
        })
    }

    /// Used when Windows doesn't say how bright SDR white is. A guess:
    /// Windows' own default depends on the screen.
    const DEFAULT_SDR_WHITE_NITS: f32 = 200.0;

    /// A picture the capture thread is asked to take.
    struct Job {
        hwnd: isize,
        mode: CaptureMode,
        reply: mpsc::Sender<Result<(Picture, CaptureInfo), String>>,
    }

    static WORKER: OnceLock<Mutex<mpsc::Sender<Job>>> = OnceLock::new();

    /// Hands a job to the capture thread, starting it the first time.
    fn send(job: Job) {
        let worker = WORKER.get_or_init(|| {
            let (sender, jobs) = mpsc::channel();
            // If the thread can't start, every capture reports a failure.
            let _ = std::thread::Builder::new()
                .name("playcounter-screenshots".into())
                .spawn(move || run(jobs));
            Mutex::new(sender)
        });
        if let Ok(sender) = worker.lock() {
            let _ = sender.send(job);
        }
    }

    /// One picture at a time. Each one makes its own graphics device and lets
    /// it go after. Keeping one ready would save about 0.1 s per picture but
    /// hold about 37 MB more. The graphics driver stays loaded after the first
    /// picture either way.
    fn run(jobs: mpsc::Receiver<Job>) {
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        for Job { hwnd, mode, reply } in jobs {
            let started = Instant::now();
            let result = Devices::new()
                .and_then(|devices| capture(&devices, HWND(hwnd as *mut _), mode, ms(started)));
            let _ = reply.send(result);
        }
    }

    pub fn start_capture(hwnd: isize, mode: CaptureMode) -> PendingCapture {
        let (reply, receiver) = mpsc::channel();
        send(Job { hwnd, mode, reply });
        PendingCapture(receiver)
    }

    /// The graphics device, in both forms capture needs.
    struct Devices {
        d3d: ID3D11Device,
        device: IDirect3DDevice,
    }

    impl Devices {
        fn new() -> Result<Self, String> {
            let d3d = create_device()?;
            let device = winrt_device(&d3d)?;
            Ok(Self { d3d, device })
        }
    }

    fn capture(
        devices: &Devices,
        hwnd: HWND,
        mode: CaptureMode,
        device_ms: f64,
    ) -> Result<(Picture, CaptureInfo), String> {
        unsafe {
            if !IsWindow(Some(hwnd)).as_bool() {
                return Err("The window is gone.".into());
            }
            if IsIconic(hwnd).as_bool() {
                return Err(MINIMIZED.into());
            }
        }
        let mut info = CaptureInfo {
            device_ms,
            ..CaptureInfo::default()
        };
        let (d3d, device) = (&devices.d3d, &devices.device);
        let hdr = mode == CaptureMode::Auto && monitor_is_hdr(hwnd.0 as isize) == Some(true);
        let (format, pixel_bytes) = if hdr {
            (DirectXPixelFormat::R16G16B16A16Float, 8)
        } else {
            (DirectXPixelFormat::B8G8R8A8UIntNormalized, 4)
        };

        let started = Instant::now();
        let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
            .map_err(text)?;
        let item: GraphicsCaptureItem = unsafe { interop.CreateForWindow(hwnd) }.map_err(text)?;
        let size = item.Size().map_err(text)?;
        info.item_ms = ms(started);

        let started = Instant::now();
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(device, format, 1, size)
            .map_err(text)?;
        let session = pool.CreateCaptureSession(&item).map_err(text)?;
        // Both need newer Windows builds; without them the capture still works.
        info.cursor_hidden = session.SetIsCursorCaptureEnabled(false).is_ok();
        info.border_off_accepted = session.SetIsBorderRequired(false).is_ok();
        let (sender, receiver) = mpsc::channel::<Direct3D11CaptureFrame>();
        pool.FrameArrived(&TypedEventHandler::new(
            move |pool: &Option<Direct3D11CaptureFramePool>, _| {
                if let Some(pool) = pool {
                    if let Ok(frame) = pool.TryGetNextFrame() {
                        let _ = sender.send(frame);
                    }
                }
                Ok(())
            },
        ))
        .map_err(text)?;
        session.StartCapture().map_err(text)?;
        let frame = receiver.recv_timeout(FRAME_TIMEOUT);
        info.first_frame_ms = ms(started);
        // One frame is all we need; stop before reading it back.
        let _ = session.Close();
        let frame = frame.map_err(|_| "Windows sent no picture of the window.".to_string())?;

        let started = Instant::now();
        let content = frame.ContentSize().map_err(text)?;
        let surface = frame.Surface().map_err(text)?;
        let access: IDirect3DDxgiInterfaceAccess = surface.cast().map_err(text)?;
        let texture: ID3D11Texture2D = unsafe { access.GetInterface() }.map_err(text)?;
        let (pixels, stride, texture_width, texture_height) = read_texture(d3d, &texture)?;
        let _ = frame.Close();
        let _ = pool.Close();

        info.frame_width = (content.Width.max(0) as u32).min(texture_width);
        info.frame_height = (content.Height.max(0) as u32).min(texture_height);
        let (origin, client) = window_geometry(hwnd)?;
        let crop = client_crop(origin, (info.frame_width, info.frame_height), client)
            .ok_or_else(|| "The window has no picture area.".to_string())?;
        info.crop = Some(crop);
        let (width, height) = (crop.width() as u32, crop.height() as u32);
        let cropped = crop_pixels(&pixels, stride, crop, pixel_bytes);
        let bgra = if hdr {
            let white = sdr_white_nits(hwnd).unwrap_or(DEFAULT_SDR_WHITE_NITS);
            info.hdr = true;
            info.sdr_white_nits = Some(white);
            crate::screenshot::hdr::hdr_to_bgra(&cropped, width, height, width as usize * 8, white)
        } else {
            cropped
        };
        info.copy_ms = ms(started);
        Ok((
            Picture {
                width,
                height,
                bgra,
            },
            info,
        ))
    }

    /// Windows' "SDR content brightness" for the window's screen, in nits:
    /// how bright normal white is shown in HDR mode.
    fn sdr_white_nits(hwnd: HWND) -> Option<f32> {
        unsafe {
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut monitor_info = MONITORINFOEXW::default();
            monitor_info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
            if !GetMonitorInfoW(monitor, &mut monitor_info.monitorInfo).as_bool() {
                return None;
            }
            let (mut path_count, mut mode_count) = (0u32, 0u32);
            if GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut path_count, &mut mode_count)
                != ERROR_SUCCESS
            {
                return None;
            }
            let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); path_count as usize];
            let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); mode_count as usize];
            if QueryDisplayConfig(
                QDC_ONLY_ACTIVE_PATHS,
                &mut path_count,
                paths.as_mut_ptr(),
                &mut mode_count,
                modes.as_mut_ptr(),
                None,
            ) != ERROR_SUCCESS
            {
                return None;
            }
            for path in paths.iter().take(path_count as usize) {
                let mut source = DISPLAYCONFIG_SOURCE_DEVICE_NAME {
                    header: DISPLAYCONFIG_DEVICE_INFO_HEADER {
                        r#type: DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
                        size: std::mem::size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32,
                        adapterId: path.sourceInfo.adapterId,
                        id: path.sourceInfo.id,
                    },
                    ..Default::default()
                };
                if DisplayConfigGetDeviceInfo(&mut source.header) != 0
                    || source.viewGdiDeviceName != monitor_info.szDevice
                {
                    continue;
                }
                let mut white = DISPLAYCONFIG_SDR_WHITE_LEVEL {
                    header: DISPLAYCONFIG_DEVICE_INFO_HEADER {
                        r#type: DISPLAYCONFIG_DEVICE_INFO_GET_SDR_WHITE_LEVEL,
                        size: std::mem::size_of::<DISPLAYCONFIG_SDR_WHITE_LEVEL>() as u32,
                        adapterId: path.targetInfo.adapterId,
                        id: path.targetInfo.id,
                    },
                    ..Default::default()
                };
                // 1000 means 80 nits.
                if DisplayConfigGetDeviceInfo(&mut white.header) == 0 && white.SDRWhiteLevel > 0 {
                    return Some(white.SDRWhiteLevel as f32 / 1000.0 * 80.0);
                }
            }
            None
        }
    }

    fn create_device() -> Result<ID3D11Device, String> {
        let mut device = None;
        unsafe {
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                None,
            )
        }
        .map_err(text)?;
        device.ok_or_else(|| "No graphics device.".to_string())
    }

    fn winrt_device(d3d: &ID3D11Device) -> Result<IDirect3DDevice, String> {
        let dxgi: IDXGIDevice = d3d.cast().map_err(text)?;
        let inspectable = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi) }.map_err(text)?;
        inspectable.cast().map_err(text)
    }

    /// Copies the frame into memory the CPU can read: the pixels, the bytes
    /// per row, and the texture's size.
    fn read_texture(
        device: &ID3D11Device,
        texture: &ID3D11Texture2D,
    ) -> Result<(Vec<u8>, usize, u32, u32), String> {
        unsafe {
            let mut desc = D3D11_TEXTURE2D_DESC::default();
            texture.GetDesc(&mut desc);
            desc.Usage = D3D11_USAGE_STAGING;
            desc.BindFlags = 0;
            desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
            desc.MiscFlags = 0;
            let mut staging = None;
            device
                .CreateTexture2D(&desc, None, Some(&mut staging))
                .map_err(text)?;
            let staging = staging.ok_or_else(|| "No readable copy of the picture.".to_string())?;
            let context = device.GetImmediateContext().map_err(text)?;
            context.CopyResource(&staging, texture);
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            context
                .Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
                .map_err(text)?;
            let stride = mapped.RowPitch as usize;
            let pixels = std::slice::from_raw_parts(
                mapped.pData as *const u8,
                stride * desc.Height as usize,
            )
            .to_vec();
            context.Unmap(&staging, 0);
            Ok((pixels, stride, desc.Width, desc.Height))
        }
    }

    /// The screen position of the captured frame's first pixel (the window's
    /// visible bounds, without the invisible resize border) and the client
    /// area on the screen. Physical pixels for a per-monitor DPI aware process.
    fn window_geometry(hwnd: HWND) -> Result<((i32, i32), PixelRect), String> {
        unsafe {
            let mut bounds = RECT::default();
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut bounds as *mut RECT as *mut _,
                std::mem::size_of::<RECT>() as u32,
            )
            .map_err(text)?;
            let mut client = RECT::default();
            GetClientRect(hwnd, &mut client).map_err(text)?;
            let mut origin = POINT { x: 0, y: 0 };
            if !ClientToScreen(hwnd, &mut origin).as_bool() {
                return Err("The window's position is unknown.".into());
            }
            Ok((
                (bounds.left, bounds.top),
                PixelRect {
                    left: origin.x,
                    top: origin.y,
                    right: origin.x + client.right,
                    bottom: origin.y + client.bottom,
                },
            ))
        }
    }

    fn file_size(path: &Path) -> Result<u64, String> {
        std::fs::metadata(path)
            .map(|metadata| metadata.len())
            .map_err(|error| error.to_string())
    }

    fn imaging_factory() -> Result<IWICImagingFactory, String> {
        unsafe { CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER) }
            .map_err(text)
    }

    /// The size that fits `max_width`, keeping the shape. Never larger.
    fn fitted(width: u32, height: u32, max_width: Option<u32>) -> (u32, u32) {
        match max_width {
            Some(max) if width > max && max > 0 => {
                let scaled = (u64::from(height) * u64::from(max) / u64::from(width)).max(1);
                (max, scaled as u32)
            }
            _ => (width, height),
        }
    }

    /// `source` at its size, or scaled down to (width, height).
    fn scaled(
        factory: &IWICImagingFactory,
        source: &IWICBitmapSource,
        (width, height): (u32, u32),
        (source_width, source_height): (u32, u32),
    ) -> Result<IWICBitmapSource, String> {
        if (width, height) == (source_width, source_height) {
            return Ok(source.clone());
        }
        unsafe {
            let scaler = factory.CreateBitmapScaler().map_err(text)?;
            scaler
                .Initialize(source, width, height, WICBitmapInterpolationModeFant)
                .map_err(text)?;
            scaler.cast().map_err(text)
        }
    }

    pub fn save_jpeg(
        picture: &Picture,
        path: &Path,
        max_width: Option<u32>,
        quality: f32,
    ) -> Result<u64, String> {
        on_com_thread(|| unsafe {
            let factory = imaging_factory()?;
            // 32bppBGR: the fourth byte is ignored, so a game's empty alpha
            // can't turn the picture black.
            let bitmap = factory
                .CreateBitmapFromMemory(
                    picture.width,
                    picture.height,
                    &GUID_WICPixelFormat32bppBGR,
                    picture.width * 4,
                    &picture.bgra,
                )
                .map_err(text)?;
            let size = fitted(picture.width, picture.height, max_width);
            let source = scaled(
                &factory,
                &bitmap.cast().map_err(text)?,
                size,
                (picture.width, picture.height),
            )?;
            encode_jpeg(&factory, &source, size, path, quality)
        })?;
        file_size(path)
    }

    pub fn save_preview_from_file(
        source: &Path,
        path: &Path,
        max_width: u32,
        quality: f32,
    ) -> Result<u64, String> {
        on_com_thread(|| unsafe {
            let factory = imaging_factory()?;
            let decoder = factory
                .CreateDecoderFromFilename(
                    &HSTRING::from(source.as_os_str()),
                    None,
                    GENERIC_READ,
                    WICDecodeMetadataCacheOnDemand,
                )
                .map_err(text)?;
            let frame = decoder.GetFrame(0).map_err(text)?;
            let (mut width, mut height) = (0, 0);
            frame.GetSize(&mut width, &mut height).map_err(text)?;
            let converter = factory.CreateFormatConverter().map_err(text)?;
            converter
                .Initialize(
                    &frame,
                    &GUID_WICPixelFormat24bppBGR,
                    WICBitmapDitherTypeNone,
                    None,
                    0.0,
                    WICBitmapPaletteTypeCustom,
                )
                .map_err(text)?;
            let size = fitted(width, height, Some(max_width));
            let picture = scaled(
                &factory,
                &converter.cast().map_err(text)?,
                size,
                (width, height),
            )?;
            encode_jpeg(&factory, &picture, size, path, quality)
        })?;
        file_size(path)
    }

    fn encode_jpeg(
        factory: &IWICImagingFactory,
        source: &IWICBitmapSource,
        (width, height): (u32, u32),
        path: &Path,
        quality: f32,
    ) -> Result<(), String> {
        unsafe {
            let stream = factory.CreateStream().map_err(text)?;
            stream
                .InitializeFromFilename(&HSTRING::from(path.as_os_str()), GENERIC_WRITE.0)
                .map_err(text)?;
            let encoder = factory
                .CreateEncoder(&GUID_ContainerFormatJpeg, std::ptr::null())
                .map_err(text)?;
            encoder
                .Initialize(&stream, WICBitmapEncoderNoCache)
                .map_err(text)?;
            let (mut frame, mut options) = (None, None);
            encoder
                .CreateNewFrame(&mut frame, &mut options)
                .map_err(text)?;
            let frame = frame.ok_or_else(|| "The JPEG encoder made no frame.".to_string())?;
            if let Some(options) = &options {
                let mut name: Vec<u16> = "ImageQuality\0".encode_utf16().collect();
                let property = PROPBAG2 {
                    pstrName: PWSTR(name.as_mut_ptr()),
                    ..Default::default()
                };
                let value = VARIANT {
                    Anonymous: VARIANT_0 {
                        Anonymous: std::mem::ManuallyDrop::new(VARIANT_0_0 {
                            vt: VT_R4,
                            wReserved1: 0,
                            wReserved2: 0,
                            wReserved3: 0,
                            Anonymous: VARIANT_0_0_0 {
                                fltVal: quality.clamp(0.0, 1.0),
                            },
                        }),
                    },
                };
                options.Write(1, &property, &value).map_err(text)?;
            }
            frame.Initialize(options.as_ref()).map_err(text)?;
            frame.SetSize(width, height).map_err(text)?;
            let mut format = GUID_WICPixelFormat24bppBGR;
            frame.SetPixelFormat(&mut format).map_err(text)?;
            frame.WriteSource(source, std::ptr::null()).map_err(text)?;
            frame.Commit().map_err(text)?;
            encoder.Commit().map_err(text)?;
            Ok(())
        }
    }

    pub fn request_borderless_capture() -> String {
        on_com_thread(|| {
            let operation =
                GraphicsCaptureAccess::RequestAccessAsync(GraphicsCaptureAccessKind::Borderless)
                    .map_err(|error| format!("not available ({})", error.message()))?;
            let status = operation
                .get()
                .map_err(|error| format!("failed ({})", error.message()))?;
            Ok(match status.0 {
                0 => "DeniedBySystem".to_string(),
                1 => "NotDeclaredByApp".to_string(),
                2 => "DeniedByUser".to_string(),
                3 => "UserPromptRequired".to_string(),
                4 => "Allowed".to_string(),
                other => format!("unknown ({other})"),
            })
        })
        .unwrap_or_else(|error| error)
    }

    pub fn monitor_is_hdr(hwnd: isize) -> Option<bool> {
        unsafe {
            let monitor = MonitorFromWindow(HWND(hwnd as *mut _), MONITOR_DEFAULTTONEAREST);
            let factory: IDXGIFactory1 = CreateDXGIFactory1().ok()?;
            let mut adapter_index = 0;
            while let Ok(adapter) = factory.EnumAdapters1(adapter_index) {
                let mut output_index = 0;
                while let Ok(output) = adapter.EnumOutputs(output_index) {
                    if output.GetDesc().ok()?.Monitor == monitor {
                        let output: IDXGIOutput6 = output.cast().ok()?;
                        let desc = output.GetDesc1().ok()?;
                        return Some(desc.ColorSpace == DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020);
                    }
                    output_index += 1;
                }
                adapter_index += 1;
            }
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(width: u32, height: u32, pixel: impl Fn(u32, u32) -> [u8; 4]) -> Vec<u8> {
        let mut pixels = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            for x in 0..width {
                pixels.extend_from_slice(&pixel(x, y));
            }
        }
        pixels
    }

    #[test]
    fn refuses_an_all_black_frame() {
        let pixels = frame(64, 36, |_, _| [0, 0, 0, 255]);
        assert!(looks_black(&pixels, 64, 36, 64 * 4));
    }

    #[test]
    fn ignores_alpha_when_checking_for_black() {
        let pixels = frame(64, 36, |_, _| [0, 0, 0, 0]);
        assert!(looks_black(&pixels, 64, 36, 64 * 4));
        let pixels = frame(64, 36, |_, _| [30, 60, 90, 0]);
        assert!(!looks_black(&pixels, 64, 36, 64 * 4));
    }

    #[test]
    fn keeps_a_dark_noisy_scene() {
        // A night scene: almost black, but with the noise real pictures have.
        let pixels = frame(64, 36, |x, y| {
            let value = ((x * 7 + y * 13) % 9) as u8;
            [value, value / 2, value, 255]
        });
        assert!(!looks_black(&pixels, 64, 36, 64 * 4));
    }

    #[test]
    fn keeps_a_letterboxed_picture() {
        // A 21:9 game on a 16:9 screen: black bars above and below.
        let pixels = frame(64, 36, |_, y| {
            if !(5..31).contains(&y) {
                [0, 0, 0, 255]
            } else {
                [40, 90, 160, 255]
            }
        });
        assert!(!looks_black(&pixels, 64, 36, 64 * 4));
    }

    #[test]
    fn skips_the_padding_at_the_end_of_each_row() {
        // The graphics card's rows are wider than the picture; the padding
        // (white here) is not part of it.
        let (width, height, stride) = (10u32, 4u32, 64usize);
        let mut pixels = vec![255u8; stride * height as usize];
        for y in 0..height as usize {
            for x in 0..width as usize {
                let at = y * stride + x * 4;
                pixels[at..at + 4].copy_from_slice(&[0, 0, 0, 255]);
            }
        }
        assert!(looks_black(&pixels, width, height, stride));
    }

    #[test]
    fn counts_an_empty_picture_as_black() {
        assert!(looks_black(&[], 0, 0, 0));
    }

    #[test]
    fn crops_title_bar_and_borders_of_a_windowed_game() {
        // Visible window bounds at (100, 200), 1282x751. The 1280x720 client
        // area starts 1 px right of the border and below a 30 px title bar.
        let crop = client_crop(
            (100, 200),
            (1282, 751),
            PixelRect {
                left: 101,
                top: 230,
                right: 1381,
                bottom: 950,
            },
        );
        assert_eq!(
            crop,
            Some(PixelRect {
                left: 1,
                top: 30,
                right: 1281,
                bottom: 750
            })
        );
    }

    #[test]
    fn keeps_the_whole_frame_of_a_borderless_game() {
        let crop = client_crop(
            (0, 0),
            (2560, 1440),
            PixelRect {
                left: 0,
                top: 0,
                right: 2560,
                bottom: 1440,
            },
        );
        assert_eq!(
            crop,
            Some(PixelRect {
                left: 0,
                top: 0,
                right: 2560,
                bottom: 1440
            })
        );
    }

    #[test]
    fn crops_on_a_monitor_left_of_the_main_one() {
        let crop = client_crop(
            (-1920, 0),
            (1920, 1080),
            PixelRect {
                left: -1920,
                top: 0,
                right: 0,
                bottom: 1080,
            },
        );
        assert_eq!(
            crop,
            Some(PixelRect {
                left: 0,
                top: 0,
                right: 1920,
                bottom: 1080
            })
        );
    }

    #[test]
    fn stays_inside_a_frame_smaller_than_the_client_area() {
        // The window grew between capturing and measuring.
        let crop = client_crop(
            (0, 0),
            (800, 600),
            PixelRect {
                left: 0,
                top: 20,
                right: 1000,
                bottom: 900,
            },
        );
        assert_eq!(
            crop,
            Some(PixelRect {
                left: 0,
                top: 20,
                right: 800,
                bottom: 600
            })
        );
    }

    #[test]
    fn gives_no_crop_without_a_client_area_in_the_frame() {
        let empty = PixelRect {
            left: 10,
            top: 10,
            right: 10,
            bottom: 300,
        };
        assert_eq!(client_crop((0, 0), (800, 600), empty), None);
        let outside = PixelRect {
            left: 900,
            top: 10,
            right: 1000,
            bottom: 300,
        };
        assert_eq!(client_crop((0, 0), (800, 600), outside), None);
    }

    #[test]
    fn fills_the_rounded_corners_of_a_windowed_game() {
        const ORANGE: [u8; 4] = [0, 128, 255, 255];
        let (width, height) = (40u32, 34u32);
        let cut = [
            (0, 0),
            (1, 0),
            (0, 1),
            (width - 1, 0),
            (0, height - 1),
            (1, height - 1),
            (0, height - 2),
            (width - 1, height - 1),
            (width - 2, height - 1),
            (width - 1, height - 2),
        ];
        let mut pixels = frame(width, height, |x, y| {
            if cut.contains(&(x, y)) {
                [0, 0, 0, 35]
            } else {
                ORANGE
            }
        });
        fill_rounded_corners(&mut pixels, width, height);
        assert!(pixels.chunks(4).all(|pixel| pixel == ORANGE));
    }

    #[test]
    fn leaves_see_through_pixels_away_from_the_corners() {
        let (width, height) = (40u32, 34u32);
        let mut pixels = frame(width, height, |x, y| {
            if (x, y) == (20, 17) {
                [9, 9, 9, 0]
            } else {
                [0, 128, 255, 255]
            }
        });
        fill_rounded_corners(&mut pixels, width, height);
        let at = (17 * width as usize + 20) * 4;
        assert_eq!(&pixels[at..at + 4], &[9, 9, 9, 0]);
    }

    #[test]
    fn leaves_pictures_without_opaque_pixels_alone() {
        // Some games write alpha 0 everywhere: nothing to copy from.
        let mut pixels = frame(40, 34, |x, y| [x as u8, y as u8, 30, 0]);
        let before = pixels.clone();
        fill_rounded_corners(&mut pixels, 40, 34);
        assert_eq!(pixels, before);
    }

    #[test]
    fn copies_only_the_cropped_pixels() {
        // 4x3 frame with 20 bytes per row (4 bytes of padding). Every pixel
        // holds its own x and y.
        let stride = 20;
        let mut pixels = vec![0xEEu8; stride * 3];
        for y in 0..3usize {
            for x in 0..4usize {
                let at = y * stride + x * 4;
                pixels[at..at + 4].copy_from_slice(&[x as u8, y as u8, 7, 255]);
            }
        }
        let crop = PixelRect {
            left: 1,
            top: 1,
            right: 3,
            bottom: 3,
        };
        assert_eq!(
            crop_bgra(&pixels, stride, crop),
            vec![
                1, 1, 7, 255, 2, 1, 7, 255, //
                1, 2, 7, 255, 2, 2, 7, 255,
            ]
        );
    }
}
