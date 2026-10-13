var root=AppContext.BaseDirectory;
File.AppendAllText(Path.Combine(root,"invocations.txt"),Environment.ProcessPath+"|"+string.Join("|",args)+"\n");
if(args.Contains("--keep-alive")) { File.WriteAllText(Path.Combine(root,"started.marker"),"ready"); return 0; }
int code=File.Exists(Path.Combine(root,"exitcode.txt")) ? int.Parse(File.ReadAllText(Path.Combine(root,"exitcode.txt"))) : 0;
if(code==0) { if(Path.GetFileName(Environment.ProcessPath).StartsWith("unins")) File.Delete(Path.Combine(root,"installed.marker")); else File.WriteAllText(Path.Combine(root,"installed.marker"),"installed"); }
return code;
