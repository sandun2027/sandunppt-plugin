// Generated from tool-catalog.json by taskpane/scripts/generate-tools.mjs.
using System;
using System.Linq;
using System.Text;
namespace Sandun.PresentationBootstrap
{
    internal sealed class ToolDefinition
    {
        internal readonly string Id, Label, Category;
        internal readonly bool Panel;
        internal ToolDefinition(string id, string label, string category, bool panel) { Id = id; Label = label; Category = category; Panel = panel; }
    }
    internal static class ToolCatalog
    {
        internal static readonly ToolDefinition[] All = {
            new ToolDefinition("page-height", "页面撑高", "view", false),
            new ToolDefinition("guides", "参考线", "view", false),
            new ToolDefinition("master", "母版设置", "view", false),
            new ToolDefinition("zoom", "整体缩放", "view", true),
            new ToolDefinition("layers", "图层管理", "object", false),
            new ToolDefinition("select-between", "连选", "object", false),
            new ToolDefinition("select-inverse", "反选", "object", false),
            new ToolDefinition("select-type", "相同类型", "object", false),
            new ToolDefinition("select-font", "相同字体/字号", "object", false),
            new ToolDefinition("select-width", "相同宽度", "object", false),
            new ToolDefinition("select-height", "相同高度", "object", false),
            new ToolDefinition("select-color", "相同颜色", "object", false),
            new ToolDefinition("select-lines", "所有线条", "object", false),
            new ToolDefinition("select-text", "所有文字", "object", false),
            new ToolDefinition("select-groups", "所有组合", "object", false),
            new ToolDefinition("group-near", "亲密性组合", "object", false),
            new ToolDefinition("group", "组合保留样式", "object", false),
            new ToolDefinition("ungroup-style", "取消组合保留样式", "object", false),
            new ToolDefinition("ungroup-slide", "解散页面组合", "object", false),
            new ToolDefinition("ungroup-selection", "解散选定组合", "object", false),
            new ToolDefinition("layer-up", "上层", "object", false),
            new ToolDefinition("layer-down", "下层", "object", false),
            new ToolDefinition("duplicate", "原位复制", "object", false),
            new ToolDefinition("fill-slide", "填充画面", "object", false),
            new ToolDefinition("crop-slide", "全屏裁剪", "object", false),
            new ToolDefinition("trim", "修边", "object", false),
            new ToolDefinition("mask", "遮罩", "object", true),
            new ToolDefinition("merge", "布尔运算", "object", true),
            new ToolDefinition("round-corners", "圆角", "object", true),
            new ToolDefinition("export-images", "导出图片", "export", true),
            new ToolDefinition("export-fonts", "导出字体", "export", false),
            new ToolDefinition("outline", "字体转曲", "export", false),
            new ToolDefinition("export-video", "导出选定页视频", "export", true),
            new ToolDefinition("unify-fonts", "统一字体", "object", true),
            new ToolDefinition("super-brush", "超级刷", "object", true),
            new ToolDefinition("collage", "PPT 拼图", "export", true),
            new ToolDefinition("version", "插件版本", "about", true),
        };
        internal static ToolDefinition Find(string id) { var tool = All.FirstOrDefault(t => t.Id == id); if (tool == null) throw new ArgumentException("未知的 SANDUN 操作"); return tool; }
        internal static string Ribbon()
        {
            return "<group id='SANDUN.Tools.view' label='视图'><button id='SANDUN.Tool.zoom' tag='zoom' label='整体缩放' screentip='整体缩放' getImage='GetToolImage' onAction='OnNativeToolClick' size='large'/><box id='SANDUN.Box.view' boxStyle='vertical'><button id='SANDUN.Tool.page-height' tag='page-height' label='页面撑高' screentip='页面撑高' getImage='GetToolImage' onAction='OnNativeToolClick' /><button id='SANDUN.Tool.guides' tag='guides' label='参考线' screentip='参考线' getImage='GetToolImage' onAction='OnNativeToolClick' /><button id='SANDUN.Tool.master' tag='master' label='母版设置' screentip='母版设置' getImage='GetToolImage' onAction='OnNativeToolClick' /></box></group><group id='SANDUN.Tools.object' label='对象'><splitButton id='SANDUN.Filter' size='large'><button id='SANDUN.Tool.layers' tag='layers' label='筛选' screentip='图层管理' getImage='GetToolImage' onAction='OnNativeToolClick' /><menu id='SANDUN.FilterMenu'><button id='SANDUN.Tool.select-between' tag='select-between' label='连选' screentip='连选' getImage='GetToolImage' onAction='OnNativeToolClick' /><button id='SANDUN.Tool.select-inverse' tag='select-inverse' label='反选' screentip='反选' getImage='GetToolImage' onAction='OnNativeToolClick' /><button id='SANDUN.Tool.select-type' tag='select-type' label='相同类型' screentip='相同类型' getImage='GetToolImage' onAction='OnNativeToolClick' /><button id='SANDUN.Tool.select-font' tag='select-font' label='相同字体/字号' screentip='相同字体/字号' getImage='GetToolImage' onAction='OnNativeToolClick' /><button id='SANDUN.Tool.select-width' tag='select-width' label='相同宽度' screentip='相同宽度' getImage='GetToolImage' onAction='OnNativeToolClick' /><button id='SANDUN.Tool.select-height' tag='select-height' label='相同高度' screentip='相同高度' getImage='GetToolImage' onAction='OnNativeToolClick' /><button id='SANDUN.Tool.select-color' tag='select-color' label='相同颜色' screentip='相同颜色' getImage='GetToolImage' onAction='OnNativeToolClick' /><button id='SANDUN.Tool.select-lines' tag='select-lines' label='所有线条' screentip='所有线条' getImage='GetToolImage' onAction='OnNativeToolClick' /><button id='SANDUN.Tool.select-text' tag='select-text' label='所有文字' screentip='所有文字' getImage='GetToolImage' onAction='OnNativeToolClick' /><button id='SANDUN.Tool.select-groups' tag='select-groups' label='所有组合' screentip='所有组合' getImage='GetToolImage' onAction='OnNativeToolClick' /></menu></splitButton><button id='SANDUN.Tool.round-corners' tag='round-corners' label='圆角' screentip='圆角' getImage='GetToolImage' onAction='OnNativeToolClick' size='large'/><button id='SANDUN.Tool.unify-fonts' tag='unify-fonts' label='统一字体' screentip='统一字体' getImage='GetToolImage' onAction='OnNativeToolClick' size='large'/><button id='SANDUN.Tool.super-brush' tag='super-brush' label='超级刷' screentip='超级刷' getImage='GetToolImage' onAction='OnNativeToolClick' size='large'/><box id='SANDUN.Box.group' boxStyle='vertical'><splitButton id='SANDUN.Group'><button id='SANDUN.Tool.group' tag='group' label='组合' screentip='组合保留样式' getImage='GetToolImage' onAction='OnNativeToolClick' /><menu id='SANDUN.GroupMenu'><button id='SANDUN.Tool.group-near' tag='group-near' label='亲密性组合' screentip='亲密性组合' getImage='GetToolImage' onAction='OnNativeToolClick' /><button id='SANDUN.Tool.ungroup-style' tag='ungroup-style' label='取消组合保留样式' screentip='取消组合保留样式' getImage='GetToolImage' onAction='OnNativeToolClick' /><button id='SANDUN.Tool.ungroup-slide' tag='ungroup-slide' label='解散页面组合' screentip='解散页面组合' getImage='GetToolImage' onAction='OnNativeToolClick' /><button id='SANDUN.Tool.ungroup-selection' tag='ungroup-selection' label='解散选定组合' screentip='解散选定组合' getImage='GetToolImage' onAction='OnNativeToolClick' /></menu></splitButton><button id='SANDUN.Tool.layer-up' tag='layer-up' label='上层' screentip='上层' getImage='GetToolImage' onAction='OnNativeToolClick' /><button id='SANDUN.Tool.layer-down' tag='layer-down' label='下层' screentip='下层' getImage='GetToolImage' onAction='OnNativeToolClick' /></box><box id='SANDUN.Box.geometry' boxStyle='vertical'><button id='SANDUN.Tool.duplicate' tag='duplicate' label='原位复制' screentip='原位复制' getImage='GetToolImage' onAction='OnNativeToolClick' /><button id='SANDUN.Tool.fill-slide' tag='fill-slide' label='填充画面' screentip='填充画面' getImage='GetToolImage' onAction='OnNativeToolClick' /><button id='SANDUN.Tool.crop-slide' tag='crop-slide' label='全屏裁剪' screentip='全屏裁剪' getImage='GetToolImage' onAction='OnNativeToolClick' /></box><box id='SANDUN.Box.shape' boxStyle='vertical'><button id='SANDUN.Tool.trim' tag='trim' label='修边' screentip='修边' getImage='GetToolImage' onAction='OnNativeToolClick' /><button id='SANDUN.Tool.mask' tag='mask' label='遮罩' screentip='遮罩' getImage='GetToolImage' onAction='OnNativeToolClick' /><button id='SANDUN.Tool.merge' tag='merge' label='布尔' screentip='布尔运算' getImage='GetToolImage' onAction='OnNativeToolClick' /></box></group><group id='SANDUN.Tools.export' label='导出'><button id='SANDUN.Tool.collage' tag='collage' label='PPT 拼图' screentip='PPT 拼图' getImage='GetToolImage' onAction='OnNativeToolClick' size='large'/><box id='SANDUN.Box.export' boxStyle='vertical'><button id='SANDUN.Tool.export-images' tag='export-images' label='导出图片' screentip='导出图片' getImage='GetToolImage' onAction='OnNativeToolClick' /><button id='SANDUN.Tool.export-video' tag='export-video' label='选页视频' screentip='导出选定页视频' getImage='GetToolImage' onAction='OnNativeToolClick' /></box><box id='SANDUN.Box.fonts' boxStyle='vertical'><button id='SANDUN.Tool.export-fonts' tag='export-fonts' label='导出字体' screentip='导出字体' getImage='GetToolImage' onAction='OnNativeToolClick' /><button id='SANDUN.Tool.outline' tag='outline' label='字体转曲' screentip='字体转曲' getImage='GetToolImage' onAction='OnNativeToolClick' /></box></group><group id='SANDUN.Tools.about' label='关于'><button id='SANDUN.Tool.version' tag='version' label='插件版本' screentip='插件版本' getImage='GetToolImage' onAction='OnNativeToolClick' size='large'/></group>";
        }
    }
}
