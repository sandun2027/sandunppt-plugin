using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace Sandun.PresentationBootstrap
{
    internal static class OfficeHostWindow
    {
        internal static IntPtr Root(IntPtr handle)
        {
            if (handle == IntPtr.Zero || !IsWindow(handle)) return IntPtr.Zero;
            IntPtr root = GetAncestor(handle, 2);
            return root == IntPtr.Zero ? handle : root;
        }
        internal static IntPtr Active()
        {
            // Process.MainWindowHandle can belong to iSlide or another add-in.
            // A document window may expose a child HWND; always move its root.
            try {
                IntPtr document = Root(new IntPtr(Convert.ToInt64(NativeTools.App.ActiveWindow.HWND)));
                if (document != IntPtr.Zero && IsWindowVisible(document)) return document;
            } catch { }
            try {
                IntPtr app = Root(new IntPtr(Convert.ToInt64(NativeTools.App.HWND)));
                if (app != IntPtr.Zero && IsWindowVisible(app)) return app;
            } catch { }
            string caption = "", name = "";
            try { caption = NativeTools.App.ActiveWindow.Caption; } catch { }
            try { name = NativeTools.Deck.Name; } catch { }
            return FindDocument(caption, name);
        }
        internal static IntPtr FindDocument(string caption, string name)
        {
            if (string.IsNullOrEmpty(caption) && string.IsNullOrEmpty(name)) return IntPtr.Zero;
            IntPtr match = IntPtr.Zero;
            EnumWindows(delegate(IntPtr handle, IntPtr state) {
                if (!IsWindowVisible(handle)) return true;
                var type = new StringBuilder(256); var title = new StringBuilder(1024);
                GetClassName(handle, type, type.Capacity); GetWindowText(handle, title, title.Capacity);
                uint pid; GetWindowThreadProcessId(handle, out pid);
                string process;
                try { process = Process.GetProcessById((int)pid).ProcessName; } catch { return true; }
                bool powerpoint = process.Equals("POWERPNT", StringComparison.OrdinalIgnoreCase) && type.ToString() == "PPTFrameClass";
                bool wps = (process.Equals("wpp", StringComparison.OrdinalIgnoreCase) || process.Equals("wps", StringComparison.OrdinalIgnoreCase)) && !type.ToString().StartsWith("WindowsForms", StringComparison.Ordinal);
                if (!(powerpoint || wps)) return true;
                bool matches = MatchesTitle(title.ToString(), caption, name);
                // Tabbed WPS hosts wpp document children inside a wps.exe frame.
                // Its frame title can name another tab; move the containing frame.
                if (!matches && wps) EnumChildWindows(handle, delegate(IntPtr child, IntPtr childState) {
                    if (!IsWindowVisible(child)) return true;
                    var childTitle = new StringBuilder(1024);
                    GetWindowText(child, childTitle, childTitle.Capacity);
                    matches = MatchesTitle(childTitle.ToString(), caption, name);
                    return !matches;
                }, IntPtr.Zero);
                if (matches) {
                    match = handle; return false;
                }
                return true;
            }, IntPtr.Zero);
            return match;
        }
        private static bool MatchesTitle(string title, string caption, string name)
        {
            return MatchesName(title, caption) || MatchesName(title, name);
        }
        private static bool MatchesName(string title, string name)
        {
            return !string.IsNullOrEmpty(name) && (title.Equals(name, StringComparison.OrdinalIgnoreCase) || title.StartsWith(name + " ", StringComparison.OrdinalIgnoreCase));
        }
        private delegate bool EnumWindowProc(IntPtr window, IntPtr state);
        [DllImport("user32")] private static extern bool EnumWindows(EnumWindowProc callback, IntPtr state);
        [DllImport("user32")] private static extern bool EnumChildWindows(IntPtr window, EnumWindowProc callback, IntPtr state);
        [DllImport("user32")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("user32", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder value, int size);
        [DllImport("user32", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder value, int size);
        [DllImport("user32")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
        [DllImport("user32")] private static extern bool IsWindow(IntPtr window);
        [DllImport("user32")] private static extern bool IsWindowVisible(IntPtr window);
    }
}
