using System;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
internal static class OpenSourceSmoke {
 [STAThread] static int Main(string[] args) {
  string root=args[0], host=args[1];
  string output=Path.Combine(root,"artifacts","open-source");
  string assemblyPath=Path.Combine(root,"dist","native","SANDUN.OpenPresentationBootstrap.dll");
  dynamic app=null,deck=null,previous=null;
  try {
   AppDomain.CurrentDomain.AssemblyResolve += delegate(object sender,ResolveEventArgs e) {
    foreach(string dir in new[]{Path.GetDirectoryName(assemblyPath),Path.Combine(root,"native/lib"),Path.Combine(root,"native/lib/webview2")}) {
     string file=Path.Combine(dir,new AssemblyName(e.Name).Name+".dll");if(File.Exists(file))return Assembly.LoadFrom(file);
    } return null;
   };
   var assembly=Assembly.LoadFrom(assemblyPath);
   app=Activator.CreateInstance(Type.GetTypeFromProgID(host=="wps"?"KWPP.Application":"PowerPoint.Application",true));
   try{previous=app.ActiveWindow;}catch{}
   assembly.GetType("Sandun.PresentationBootstrap.PresentationBootstrap",true).GetProperty("CurrentApplication",BindingFlags.NonPublic|BindingFlags.Static).SetValue(null,app,null);
   dynamic bridge=Activator.CreateInstance(assembly.GetType("Sandun.PresentationBootstrap.NativeOfficeBridge",true));
   deck=app.Presentations.Add(-1);deck.PageSetup.SlideWidth=960;deck.PageSetup.SlideHeight=540;
   foreach(string name in new[]{"diagram","chart","image","cover"}) {
    dynamic slide=deck.Slides.Add(deck.Slides.Count+1,12);deck.Windows.Item(1).Activate();app.ActiveWindow.View.GotoSlide(slide.SlideIndex);Application.DoEvents();
    string target=bridge.CaptureSvgTarget();
    if(name=="cover")bridge.InsertCover(File.ReadAllText(Path.Combine(output,"cover-background.svg")),File.ReadAllText(Path.Combine(output,"cover-title.svg")),target);
    else bridge.InsertSvg(File.ReadAllText(Path.Combine(output,name+".svg")),target,name);
    if((int)slide.Shapes.Count!=(name=="cover"?2:1))throw new Exception("Unexpected shape count: "+name);
    slide.Export(Path.Combine(output,host+"-"+name+".png"),"PNG",960,540);
   }
   deck.SaveAs(Path.Combine(output,host+"-ai-smoke.pptx"),24);
   File.WriteAllText(Path.Combine(output,host+"-native-result.txt"),"PASS: diagram, chart, image and two-layer cover inserted using the open-source native assembly.");
   Console.WriteLine("PASS "+host+": four AI tools inserted; cover retains separate background and title layers");return 0;
  } catch(Exception e){File.WriteAllText(Path.Combine(output,host+"-native-result.txt"),e.ToString());Console.Error.WriteLine(e);return 1;}
  finally {if(deck!=null){deck.Saved=-1;deck.Close();}try{if(previous!=null)previous.Activate();}catch{}}
 }
}
