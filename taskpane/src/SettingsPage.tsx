import { useEffect, useState } from "react";
import { Check, Eye, EyeOff, Settings, ShieldCheck } from "lucide-react";
import { api } from "./api";
import type { ProviderConfigs, ProviderInput } from "./types";

const defaults: ProviderConfigs = {
  text: {base_url:"https://api.openai.com/v1",model:"gpt-5.6-luna",key_configured:false},
  image: {base_url:"https://api.openai.com/v1",model:"gpt-image-2.5-sunburst",key_configured:false},
};
export function SettingsPage() {
  const [saved,setSaved]=useState(defaults);
  const [values,setValues]=useState<Record<"text"|"image",ProviderInput>>(defaults);
  const [visible,setVisible]=useState({text:false,image:false});
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [checks,setChecks]=useState({text:"",image:""});
  useEffect(()=>{api.config().then(data=>{setSaved(data);setValues(data)}).catch(e=>setError(e.message)).finally(()=>setLoading(false))},[]);
  function update(kind:"text"|"image",patch:Partial<ProviderInput>) {setValues(v=>({...v,[kind]:{...v[kind],...patch}}));setNotice("");setChecks(c=>({...c,[kind]:""}));}
  async function save() {
    setBusy("save");setError("");setNotice("");
    try {const data=await api.saveConfig(values);setSaved(data);setValues(data);setNotice("配置已保存，API Key 已在本机加密保护。");}
    catch(e){setError(e instanceof Error?e.message:"保存失败")}
    finally{setBusy("")}
  }
  async function check(kind:"text"|"image") {
    setBusy(kind);setError("");setChecks(c=>({...c,[kind]:"正在调用模型…"}));
    try {const data=await api.testConfig(kind,values[kind]);setChecks(c=>({...c,[kind]:data.message}));}
    catch(e){setChecks(c=>({...c,[kind]:e instanceof Error?e.message:"连接失败"}));}
    finally{setBusy("")}
  }
  return <section className="page provider-settings"><div className="page-heading"><div><span className="eyebrow">YOUR API, YOUR MODELS</span><h1><Settings size={25}/> 模型配置</h1></div><span className="count-label">本地保存</span></div>
    <p className="lead">连接你的模型服务。封面策划、标题、图表和图示使用文本模型；生图与封面背景使用图片模型。</p>
    {error&&<div className="message error" role="alert">{error}</div>}
    <div className="provider-grid">{(["text","image"] as const).map(kind=><section className="provider-card" key={kind}>
      <div className="provider-title"><h2>{kind==="text"?"文本模型":"图片模型"}</h2><span>{saved[kind].key_configured&&!values[kind].clear_key?<><Check size={13}/>已保存 Key</>:"待配置"}</span></div>
      <label className="form-field"><span>接口地址</span><input aria-label={`${kind==="text"?"文本":"图片"}接口地址`} disabled={loading||!!busy} value={values[kind].base_url} onChange={e=>update(kind,{base_url:e.target.value})} placeholder="https://api.example.com/v1" spellCheck={false}/></label>
      <label className="form-field"><span>模型名称</span><input aria-label={`${kind==="text"?"文本":"图片"}模型名称`} disabled={loading||!!busy} value={values[kind].model} onChange={e=>update(kind,{model:e.target.value})} spellCheck={false}/></label>
      <label className="form-field"><span>API Key</span><div className="key-input"><input aria-label={`${kind==="text"?"文本":"图片"} API Key`} type={visible[kind]?"text":"password"} autoComplete="off" spellCheck={false} disabled={loading||!!busy} value={values[kind].api_key||""} placeholder={saved[kind].key_configured?"已加密保存；留空保留现有 Key":"填写服务商提供的 API Key"} onChange={e=>update(kind,{api_key:e.target.value,clear_key:false})}/><button type="button" aria-label={visible[kind]?"隐藏 Key":"显示 Key"} onClick={()=>setVisible(v=>({...v,[kind]:!v[kind]}))}>{visible[kind]?<EyeOff size={17}/>:<Eye size={17}/>}</button></div></label>
      <div className="provider-actions"><button className="secondary-button" disabled={loading||!!busy} onClick={()=>void check(kind)}>{busy===kind?"正在校验…":"校验连通性"}</button>{saved[kind].key_configured&&<button className="text-button" disabled={!!busy} onClick={()=>update(kind,{api_key:"",clear_key:true})}>{values[kind].clear_key?"保存后清除 Key":"清除已保存 Key"}</button>}</div>
      <p className="provider-help">{kind==="text"?"兼容 Chat Completions 接口；校验会发起一次简短文本请求。":"兼容 Images Generations 接口；校验会实际生成一张测试图片，可能产生服务商费用。"}</p>
      {checks[kind]&&<p className="provider-check" role="status">{checks[kind]}</p>}
    </section>)}</div>
    <div className="settings-footer"><span><ShieldCheck size={17}/>Key 仅发送到你配置的接口，界面不会读取已保存的明文。</span><button className="primary-button" disabled={loading||!!busy} onClick={()=>void save()}>{busy==="save"?"正在保存…":"保存配置"}</button></div>
    <p className="provider-help">地址填写 API 根路径（通常以 /v1 结尾）。更换地址时请重新填写 Key。默认模型名称可修改，实际可用模型由你的服务商决定。</p>
    {notice&&<div className="provider-check" role="status">{notice}</div>}
  </section>;
}
