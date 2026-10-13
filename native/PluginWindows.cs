using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Windows.Forms;

namespace Sandun.PresentationBootstrap
{
    // WPS's COM callback must return before WebView2 starts. One STA owns all
    // windows, including creation, navigation, activation and disposal.
    internal static class PluginWindows
    {
        private static readonly object Sync = new object();
        private static Session current;

        internal static void Open(string tool)
        {
            lock (Sync)
            {
                if (current == null)
                {
                    current = new Session();
                    var thread = new Thread(current.Run) { IsBackground = true, Name = "SANDUN windows" };
                    thread.SetApartmentState(ApartmentState.STA);
                    thread.Start();
                }
                // Native tools have separate windows; the workspace follows the
                // latest route requested while its first window is starting.
                string key = tool.StartsWith("native:", StringComparison.Ordinal) ? tool : "workspace";
                current.Pending[key] = tool;
                current.Post();
            }
        }

        internal static void CloseAll()
        {
            lock (Sync)
            {
                if (current == null) return;
                var session = current;
                current = null;
                session.Stopping = true;
                session.Pending.Clear();
                if (session.Dispatcher != null)
                    session.Dispatcher.BeginInvoke(new Action(Application.ExitThread));
            }
        }

        private sealed class Session
        {
            internal readonly Dictionary<string, string> Pending = new Dictionary<string, string>();
            private readonly Dictionary<string, PluginWindow> windows = new Dictionary<string, PluginWindow>();
            internal Control Dispatcher;
            internal bool Stopping;
            private bool draining;
            private bool posted;

            internal void Post()
            {
                if (Dispatcher == null || posted || Stopping) return;
                posted = true;
                Dispatcher.BeginInvoke(new Action(Drain));
            }

            internal void Run()
            {
                try
                {
                    using (var control = new Control())
                    {
                        IntPtr handle = control.Handle;
                        lock (Sync)
                        {
                            if (Stopping) return;
                            Dispatcher = control;
                            Post();
                        }
                        try { Application.Run(); }
                        finally
                        {
                            lock (Sync) { Stopping = true; Dispatcher = null; }
                            foreach (var window in windows.Values.ToArray()) window.Dispose();
                        }
                    }
                }
                catch (Exception exception) { PresentationBootstrap.WriteLog("Window dispatcher failed: " + exception); }
                finally { lock (Sync) { if (current == this) current = null; } }
            }

            private void Drain()
            {
                KeyValuePair<string, string>[] pending;
                lock (Sync)
                {
                    posted = false;
                    if (Stopping || draining) return;
                    draining = true;
                    pending = Pending.ToArray();
                    Pending.Clear();
                }
                try
                {
                    foreach (var request in pending)
                    {
                        lock (Sync) { if (Stopping) return; }
                        try
                        {
                            PluginWindow window;
                            if (!windows.TryGetValue(request.Key, out window) || window.IsDisposed)
                            {
                                window = new PluginWindow(request.Value, OfficeHostWindow.Active());
                                windows[request.Key] = window;
                                string key = request.Key;
                                window.FormClosed += delegate { windows.Remove(key); };
                            }
                            else if (request.Key == "workspace") window.Navigate(request.Value);
                            window.ShowForUser();
                        }
                        catch (Exception exception) { PresentationBootstrap.WriteLog("Open window failed (" + request.Value + "): " + exception); }
                    }
                }
                finally
                {
                    lock (Sync) { draining = false; if (Pending.Count > 0) Post(); }
                }
            }
        }
    }
}
