using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace Sandun.PresentationBootstrap
{
    // A single white WebView surface owns all visible chrome. Win32 is used only
    // for resizing, moving, DWM shadows, and reversible side-by-side placement.
    internal sealed class PluginWindow : Form
    {
        private readonly PresentationTaskPane browser;
        private IntPtr hostWindow;
        private WindowPlacement originalHost;
        private bool hostPlacementSaved;
        private bool compact;
        private string nativeTool;
        private bool initialLayout = true;
        private string mode = "floating";
        private string beforeExpand = "floating";
        private Rectangle floatingBounds;
        private Rectangle appliedHostBounds;

        public PluginWindow(string tool, IntPtr owner)
        {
            hostWindow = OfficeHostWindow.Root(owner);
            Text = "SANDUN";
            AutoScaleMode = AutoScaleMode.None;
            FormBorderStyle = FormBorderStyle.None;
            BackColor = Color.White;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = true;
            TopMost = false;
            Padding = new Padding(1);
            browser = new PresentationTaskPane { Dock = DockStyle.Fill };
            Controls.Add(browser);
            Navigate(tool);
            FormClosed += delegate { RestoreHost(); };
            ResizeEnd += delegate {
                if (mode == "floating" && !compact) floatingBounds = Bounds;
                if (mode == "split") FitHostBesidePanel();
            };
        }

        private float ScaleFactor
        {
            get
            {
                try { uint dpi = GetDpiForWindow(hostWindow == IntPtr.Zero ? Handle : hostWindow); return dpi > 0 ? dpi / 96f : 1f; }
                catch { return 1f; }
            }
        }
        private int Dp(int value) { return (int)Math.Round(value * ScaleFactor); }
        private Rectangle WorkArea { get { return Screen.FromHandle(hostWindow == IntPtr.Zero ? Handle : hostWindow).WorkingArea; } }

        internal void ShowForUser()
        {
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Show();
            BringToFront();
            Activate();
            // Raise once on an explicit click; other apps can still cover the
            // panel afterwards and it never remains globally topmost.
            SetWindowPos(Handle, new IntPtr(-1), 0, 0, 0, 0, 0x0043);
            SetWindowPos(Handle, new IntPtr(-2), 0, 0, 0, 0, 0x0043);
            SetForegroundWindow(Handle);
        }

        internal void Navigate(string tool)
        {
            string nextNativeTool = tool.StartsWith("native:", StringComparison.Ordinal) ? tool.Substring(7) : null;
            bool nextCompact = nextNativeTool != null;
            if (initialLayout || nextCompact != compact || nativeTool != nextNativeTool)
            {
                if (!compact && mode == "floating" && !initialLayout) floatingBounds = Bounds;
                compact = nextCompact;
                nativeTool = nextNativeTool;
                MinimumSize = new Size(Math.Min(Dp(nativeTool != null ? 340 : compact ? 380 : 420), WorkArea.Width - Dp(16)), Math.Min(Dp(nativeTool != null ? 360 : 480), WorkArea.Height - Dp(16)));
                // Route changes never opt the user into splitting the presentation.
                ApplyLayout(initialLayout ? "floating" : mode, false);
                initialLayout = false;
            }
            browser.Navigate(tool);
        }

        internal void WindowCommand(string action)
        {
            if (action == "close") { Close(); return; }
            if (action == "minimize") { WindowState = FormWindowState.Minimized; return; }
            if (action == "resize-left") { ReleaseCapture(); SendMessage(Handle, 0xA1, new IntPtr(10), IntPtr.Zero); return; }
            if (action == "drag")
            {
                if (mode == "split") return;
                ReleaseCapture(); SendMessage(Handle, 0xA1, new IntPtr(2), IntPtr.Zero); return;
            }
            if (action == "split") {
                if (mode != "split") {
                    IntPtr active = OfficeHostWindow.Active();
                    if (active != IntPtr.Zero) hostWindow = active;
                }
                ApplyLayout(mode == "split" ? "floating" : "split");
                Activate();
            }
            if (action == "expand")
            {
                if (mode == "expanded") ApplyLayout(beforeExpand);
                else { beforeExpand = mode; ApplyLayout("expanded"); }
            }
            if (action == "floating") ApplyLayout("floating");
            browser.PostWindowState(mode);
        }

        private void ApplyLayout(string next, bool rememberBounds = true)
        {
            Rectangle area = WorkArea;
            int gap = Dp(8);
            if (rememberBounds && mode == "floating" && !compact && !initialLayout) floatingBounds = Bounds;
            mode = next;
            WindowState = FormWindowState.Normal;
            if (mode == "split" && hostWindow != IntPtr.Zero && IsWindow(hostWindow))
            {
                SaveHost();
                // Width follows the available display, not a fixed tiny dialog.
                int width = Math.Min(area.Width * 52 / 100, Math.Max(Dp(460), area.Width * 40 / 100));
                Bounds = new Rectangle(area.Right - width, area.Top, width, area.Height);
                FitHostBesidePanel();
            }
            else
            {
                RestoreHost();
                if (mode == "split") mode = "floating";
                int width = compact ? Math.Min(Dp(480), area.Width - gap * 2) : area.Width * 76 / 100;
                int height = compact ? Math.Min(Dp(680), area.Height - gap * 2) : area.Height * 90 / 100;
                if (nativeTool != null)
                {
                    width = Math.Min(Dp(nativeTool == "collage" ? 1040 : nativeTool == "super-brush" ? 680 : nativeTool == "zoom" || nativeTool == "unify-fonts" ? 500 : 480), area.Width - gap * 2);
                    int preferredHeight = nativeTool == "zoom" || nativeTool == "unify-fonts" || nativeTool == "super-brush" || nativeTool == "collage" ? 680 : nativeTool == "export-images" ? 600 : nativeTool == "round-corners" || nativeTool == "mask" || nativeTool == "merge" || nativeTool == "export-video" ? 600 : nativeTool == "video-progress" ? 480 : nativeTool == "notice" || nativeTool == "version" ? 400 : 550;
                    height = Math.Min(Dp(preferredHeight), area.Height - gap * 2);
                }
                if (mode == "expanded") { width = area.Width - gap * 2; height = area.Height - gap * 2; }
                Rectangle target = new Rectangle(area.Left + (area.Width - width) / 2, area.Top + (area.Height - height) / 2, width, height);
                if (mode == "floating" && !compact && floatingBounds.Width >= MinimumSize.Width && area.Contains(floatingBounds)) target = floatingBounds;
                Bounds = target;
            }
            UpdateFrame();
            browser.PostWindowState(mode);
        }

        private void SaveHost()
        {
            if (hostPlacementSaved) return;
            originalHost = new WindowPlacement();
            originalHost.length = Marshal.SizeOf(typeof(WindowPlacement));
            hostPlacementSaved = GetWindowPlacement(hostWindow, ref originalHost);
        }

        private void FitHostBesidePanel()
        {
            if (!hostPlacementSaved || !IsWindow(hostWindow)) return;
            Rectangle area = WorkArea;
            int minimumPanel = Math.Min(Dp(420), area.Width / 2);
            int panelWidth = Math.Max(minimumPanel, Math.Min(Width, area.Width * 60 / 100));
            Bounds = new Rectangle(area.Right - panelWidth, area.Top, panelWidth, area.Height);
            if (IsIconic(hostWindow) || IsZoomed(hostWindow)) ShowWindow(hostWindow, 9);
            appliedHostBounds = new Rectangle(area.Left, area.Top, Math.Max(320, area.Width - panelWidth - Dp(6)), area.Height);
            // Show and raise the document without making either window topmost.
            SetWindowPos(hostWindow, IntPtr.Zero, appliedHostBounds.X, appliedHostBounds.Y, appliedHostBounds.Width, appliedHostBounds.Height, 0x0050);
            Rect actual;
            if (GetWindowRect(hostWindow, out actual)) appliedHostBounds = Rectangle.FromLTRB(actual.left, actual.top, actual.right, actual.bottom);
            RedrawWindow(hostWindow, IntPtr.Zero, IntPtr.Zero, 0x0585);
            SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0, 0x0013);
        }

        private void RestoreHost()
        {
            if (!hostPlacementSaved) return;
            if (IsWindow(hostWindow))
            {
                Rect current;
                // Respect a user who manually moved or resized Office meanwhile.
                if (GetWindowRect(hostWindow, out current) && Math.Abs(current.left - appliedHostBounds.Left) < Dp(16) && Math.Abs(current.right - appliedHostBounds.Right) < Dp(16) && Math.Abs(current.top - appliedHostBounds.Top) < Dp(16) && Math.Abs(current.bottom - appliedHostBounds.Bottom) < Dp(16))
                    SetWindowPlacement(hostWindow, ref originalHost);
            }
            hostPlacementSaved = false;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) RestoreHost();
            base.Dispose(disposing);
        }

        protected override CreateParams CreateParams
        {
            get { CreateParams value = base.CreateParams; value.Style |= 0x00040000 | 0x00020000 | 0x00010000; return value; }
        }
        protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); UpdateFrame(); }
        private void UpdateFrame()
        {
            if (!IsHandleCreated) return;
            try
            {
                int rounded = mode == "split" ? 1 : 2;
                DwmSetWindowAttribute(Handle, 33, ref rounded, 4);
                int white = 0xFFFFFF;
                DwmSetWindowAttribute(Handle, 34, ref white, 4);
                var margins = new Margins { left = 1, right = 1, top = 1, bottom = 1 };
                DwmExtendFrameIntoClientArea(Handle, ref margins);
            }
            catch { /* Older Windows still gets the borderless white surface. */ }
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == 0x0083 && message.WParam != IntPtr.Zero) { message.Result = IntPtr.Zero; return; }
            if (message.Msg == 0x0084)
            {
                long packed = message.LParam.ToInt64();
                Point point = PointToClient(new Point((short)(packed & 0xffff), (short)((packed >> 16) & 0xffff)));
                int edge = Dp(6);
                bool left = point.X < edge, right = point.X >= ClientSize.Width - edge;
                bool top = point.Y < edge, bottom = point.Y >= ClientSize.Height - edge;
                int hit = top && left ? 13 : top && right ? 14 : bottom && left ? 16 : bottom && right ? 17 : left ? 10 : right ? 11 : top ? 12 : bottom ? 15 : 1;
                message.Result = new IntPtr(hit); return;
            }
            if (message.Msg == 0x02E0) // Move/resize correctly between monitors with different scaling.
            {
                Rect suggested = (Rect)Marshal.PtrToStructure(message.LParam, typeof(Rect));
                if (mode == "split") BeginInvoke(new Action(() => ApplyLayout("split")));
                else Bounds = Rectangle.FromLTRB(suggested.left, suggested.top, suggested.right, suggested.bottom);
                message.Result = IntPtr.Zero; return;
            }
            base.WndProc(ref message);
        }

        [StructLayout(LayoutKind.Sequential)] private struct PointNative { public int x, y; }
        [StructLayout(LayoutKind.Sequential)] private struct Rect { public int left, top, right, bottom; }
        [StructLayout(LayoutKind.Sequential)] private struct WindowPlacement { public int length, flags, showCmd; public PointNative minPosition, maxPosition; public Rect normalPosition; }
        [StructLayout(LayoutKind.Sequential)] private struct Margins { public int left, right, top, bottom; }
        [DllImport("user32")] private static extern bool IsWindow(IntPtr window);
        [DllImport("user32")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
        [DllImport("user32")] private static extern bool GetWindowPlacement(IntPtr window, ref WindowPlacement placement);
        [DllImport("user32")] private static extern bool SetWindowPlacement(IntPtr window, ref WindowPlacement placement);
        [DllImport("user32")] private static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
        [DllImport("user32")] private static extern bool ShowWindow(IntPtr window, int command);
        [DllImport("user32")] private static extern bool SetForegroundWindow(IntPtr window);
        [DllImport("user32")] private static extern bool IsIconic(IntPtr window);
        [DllImport("user32")] private static extern bool IsZoomed(IntPtr window);
        [DllImport("user32")] private static extern bool RedrawWindow(IntPtr window, IntPtr updateRect, IntPtr region, uint flags);
        [DllImport("user32")] private static extern uint GetDpiForWindow(IntPtr window);
        [DllImport("user32")] private static extern bool ReleaseCapture();
        [DllImport("user32")] private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wparam, IntPtr lparam);
        [DllImport("dwmapi")] private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
        [DllImport("dwmapi")] private static extern int DwmExtendFrameIntoClientArea(IntPtr window, ref Margins margins);
    }
}
