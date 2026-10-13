using Microsoft.Win32;
using System.Diagnostics;
using System.Security.Principal;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using System.Windows.Input;

namespace Sandun.PptRepairTool;
public partial class MainWindow : Window
{
    private readonly Maintenance maintenance;
    private List<Installation> installations = new();
    private List<CheckItem> checks = new();
    private bool busy;
    private string lastAction = "尚未执行维护操作。";
    internal Func<Task<List<Installation>>>? DiscoverOverride;
    internal Func<Task<List<CheckItem>>>? ScanOverride;
    internal Task? CurrentOperation;
    public MainWindow() : this(new Maintenance(), true) { }
    internal MainWindow(Maintenance engine, bool autoScan)
    {
        maintenance = engine; InitializeComponent();
        MaxWidth=SystemParameters.WorkArea.Width;
        MaxHeight=SystemParameters.WorkArea.Height;
        PrivilegeText.Text = new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator) ? "管理员模式 · v1.0.2" : "普通权限 · v1.0.2";
        if(autoScan) Loaded += (_,_) => CurrentOperation=RefreshAsync();
        Closing += (_,e) => { if(busy) { e.Cancel=true; Feedback("操作正在执行，请等待完成后关闭窗口。",true); } };
    }
    private static IEnumerable<Button> Buttons(DependencyObject parent)
    { for(var i=0;i<VisualTreeHelper.GetChildrenCount(parent);i++) { var child=VisualTreeHelper.GetChild(parent,i); if(child is Button b) yield return b; foreach(var descendant in Buttons(child)) yield return descendant; } }
    private void SetBusy(bool value)
    { busy=value; RefreshButton.IsEnabled=!value; foreach(var b in Buttons(Tabs)) b.IsEnabled=!value; RepairAllButton.IsEnabled=!value && checks.Any(c=>c.Repairable); }
    private void Feedback(string text,bool error=false)
    { lastAction=text; ActionText.Text=text; OperationText.Text=text; OperationBanner.Visibility=Visibility.Visible; OperationText.Foreground=Brush(error ? "#B33C4E" : "#465E78"); }
    private async Task Reload()
    {
        installations=DiscoverOverride!=null ? await DiscoverOverride() : await Task.Run(()=>Edition.All.Select(maintenance.Find).Where(i=>i!=null).Cast<Installation>().ToList());
        checks=ScanOverride!=null ? await ScanOverride() : await Task.Run(()=>maintenance.Scan(installations));
        InfoChips.Children.Clear(); ChecksPanel.Children.Clear();
        foreach(var edition in Edition.All)
        {
            var install=installations.FirstOrDefault(i=>i.Edition==edition);
            InfoChips.Children.Add(new Border { Background=Brush(install==null ? "#F1F3F6" : "#E7F7F2"),CornerRadius=new(14),Padding=new(13,6,13,6),Margin=new(0,0,8,0),Child=new TextBlock { Text=edition.Name+(install==null ? " 未安装" : " v"+install.Version),Foreground=Brush("#505E71"),FontSize=12 } });
            var label=edition==Edition.Commercial ? CommercialInstallState : OpenInstallState;
            label.Text=install==null ? "未检测到"+edition.Name : $"已安装 · v{install.Version}\n{install.Path}";
        }
        foreach(var check in checks) RenderCheck(check);
        var issues=checks.Count(c=>c.Issue);
        SummaryText.Text=issues==0 ? "所检查的配置未发现异常。请在演示软件中确认功能区和工具按钮。" : $"发现 {issues} 项需处理；每项说明均列出具体原因。";
        FooterText.Text="v1.0.2 · 最后检测："+DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
    }
    internal async Task RefreshAsync()
    {
        if(busy) return; SetBusy(true); SummaryText.Text="正在检测…";
        try { await Reload(); }
        catch(Exception ex) { Feedback("检测未完成："+ex.Message,true); SummaryText.Text="检测未完成，请查看下方原因并重试。"; }
        finally { SetBusy(false); }
    }
    private static Brush Brush(string color)=>(Brush)new BrushConverter().ConvertFromString(color)!;
    private void RenderCheck(CheckItem item)
    {
        var border=new Border { Background=Brushes.White,CornerRadius=new(10),Padding=new(18,14,18,14),Margin=new(0,0,0,9),BorderBrush=Brush("#E8ECF2"),BorderThickness=new(1) };
        var grid=new Grid(); grid.ColumnDefinitions.Add(new()); grid.ColumnDefinitions.Add(new(){Width=GridLength.Auto});
        var stack=new StackPanel(); var line=new StackPanel { Orientation=Orientation.Horizontal };
        line.Children.Add(new TextBlock { Text=item.State==ResultState.Info ? "i" : item.Issue ? "!" : "✓",FontSize=19,FontWeight=FontWeights.Bold,Foreground=Brush(item.State==ResultState.Info ? "#7B8FA8" : item.Issue ? "#EB4C56" : "#00A98C"),Margin=new(0,0,12,0) });
        line.Children.Add(new TextBlock { Text=item.Title,FontSize=16,Foreground=Brush("#1F2A39"),VerticalAlignment=VerticalAlignment.Center }); stack.Children.Add(line);
        var detail=new TextBlock { Text=item.Detail,FontSize=13,Foreground=Brush("#738094"),TextWrapping=TextWrapping.Wrap,Margin=new(32,5,12,0) }; stack.Children.Add(detail); grid.Children.Add(stack);
        if(item.Repairable)
        {
            var button=new Button { Content="立即修复",Tag=item.Id,Background=Brush("#FFF1F2"),Foreground=Brush("#CF3A4C"),Padding=new(14,8,14,8),VerticalAlignment=VerticalAlignment.Center };
            button.Click+=(_,_)=>{ detail.Text="正在处理，请稍候…"; CurrentOperation=RepairItems(new[]{item},button,detail); };
            Grid.SetColumn(button,1); grid.Children.Add(button);
        }
        border.Child=grid; ChecksPanel.Children.Add(border);
    }
    internal async Task RepairItems(IEnumerable<CheckItem> source,Button? button=null,TextBlock? detail=null)
    {
        if(busy) return;
        var targets=source.Where(c=>c.Install!=null && c.Action!=ActionKind.None).DistinctBy(c=>(c.Install!.Path,c.Action)).ToList();
        if(targets.Count==0) { Feedback("没有可自动修复的项目；请查看各项说明。",true); return; }
        SetBusy(true); if(button!=null) button.Content="修复中…";
        var failures=new List<string>(); var completed=new List<CheckItem>();
        try
        {
            foreach(var item in targets)
            {
                Feedback("正在处理："+item.Title+"。请稍候…"); await Dispatcher.Yield(DispatcherPriority.Background);
                try { await Task.Run(()=>maintenance.Repair(item.Install!,item.Action)); completed.Add(item); }
                catch(Exception ex) { failures.Add(item.Title+"："+ex.Message); }
            }
            await Reload();
            foreach(var item in completed) { var remaining=checks.FirstOrDefault(c=>c.Id==item.Id && c.Issue); if(remaining!=null) failures.Add("复检仍需处理："+remaining.Title+"，"+remaining.Detail); }
            Feedback(failures.Count==0 ? "维护完成，复检已通过。请重新打开演示软件确认。" : string.Join("\n",failures),failures.Count>0);
            if(detail!=null) detail.Text=lastAction;
        }
        catch(Exception ex) { Feedback("操作后检测失败："+ex.Message,true); if(detail!=null) detail.Text=lastAction; }
        finally { if(button!=null) button.Content="立即修复"; SetBusy(false); }
    }
    private Task Manual(ActionKind action)
    {
        if(installations.Count==0) { Feedback("未发现已安装版本，请先安装插件。",true); return Task.CompletedTask; }
        return RepairItems(installations.Select(i=>new CheckItem("manual",i.Edition.Name+" · "+action,ResultState.Attention,"",i,action)));
    }
    private void RepairAll_Click(object sender,RoutedEventArgs e)=>CurrentOperation=RepairItems(checks.Where(c=>c.Repairable).ToList());
    private void Refresh_Click(object sender,RoutedEventArgs e)=>CurrentOperation=RefreshAsync();
    private void Close_Click(object sender,RoutedEventArgs e)=>Close();
    private void Minimize_Click(object sender,RoutedEventArgs e)=>WindowState=WindowState.Minimized;
    private void TitleBar_MouseLeftButtonDown(object sender,MouseButtonEventArgs e)
    {
        if(e.ChangedButton!=MouseButton.Left || e.ButtonState!=MouseButtonState.Pressed) return;
        for(var source=e.OriginalSource as DependencyObject; source!=null && source!=sender; source=VisualTreeHelper.GetParent(source))
            if(source is Button) return;
        DragMove();
    }
    private void RepairRegistration_Click(object sender,RoutedEventArgs e)=>CurrentOperation=Manual(ActionKind.Registration);
    private void RepairWps_Click(object sender,RoutedEventArgs e)=>CurrentOperation=Manual(ActionKind.Wps);
    private void StartCore_Click(object sender,RoutedEventArgs e)=>CurrentOperation=Manual(ActionKind.Core);
    private void ClearDisabled_Click(object sender,RoutedEventArgs e)=>CurrentOperation=Manual(ActionKind.Disabled);
    private void InstallCommercial_Click(object sender,RoutedEventArgs e)=>CurrentOperation=Install(Edition.Commercial);
    private void InstallOpen_Click(object sender,RoutedEventArgs e)=>CurrentOperation=Install(Edition.Open);
    private void UninstallCommercial_Click(object sender,RoutedEventArgs e)=>CurrentOperation=Uninstall(Edition.Commercial);
    private void UninstallOpen_Click(object sender,RoutedEventArgs e)=>CurrentOperation=Uninstall(Edition.Open);
    private async Task Install(Edition edition)
    {
        if(busy) return; var file=Maintenance.FindSetup(AppContext.BaseDirectory,edition.Setup);
        if(file==null) { var picker=new OpenFileDialog { Title="选择 "+edition.Name+" 安装包",Filter="SANDUN 安装程序|*.exe",FileName=edition.Setup }; if(picker.ShowDialog(this)!=true) { Feedback("已取消选择安装包。工具未执行安装。"); return; } file=picker.FileName; }
        await PackageOperation("安装 / 更新"+edition.Name,()=>maintenance.Install(file));
    }
    private async Task Uninstall(Edition edition)
    {
        if(busy) return; var install=installations.FirstOrDefault(i=>i.Edition==edition);
        if(install==null) { Feedback("未检测到可卸载的"+edition.Name+"。",true); return; }
        await PackageOperation("卸载"+edition.Name,()=>maintenance.Uninstall(install));
    }
    private async Task PackageOperation(string title,Func<Task<CommandResult>> action)
    {
        SetBusy(true); Feedback("已启动"+title+"，请在安装 / 卸载窗口完成操作。");
        try { var result=await action(); await Reload(); Feedback(title+"程序已结束"+(result.Code==3010 ? "，需要重启电脑。" : "，已刷新安装状态；若在原窗口取消，原安装状态会保留。")); }
        catch(Exception ex) { Feedback(title+"未完成："+ex.Message,true); }
        finally { SetBusy(false); }
    }
    private void Report_Click(object sender,RoutedEventArgs e)
    {
        if(busy) return;
        try { var file=maintenance.Report(checks,lastAction); Feedback("诊断报告已保存："+file); var info=new ProcessStartInfo("explorer.exe"){UseShellExecute=true}; info.ArgumentList.Add("/select,"); info.ArgumentList.Add(file); Process.Start(info); }
        catch(Exception ex) { Feedback("报告保存或打开失败："+ex.Message,true); }
    }
}

