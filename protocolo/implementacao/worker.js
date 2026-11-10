// Cloudflare Worker da área de protocolos João Assink.
// Este arquivo NÃO é implantado automaticamente pelo GitHub Pages.
// Vincule um banco D1 como DB e configure INGEST_TOKEN, ADMIN_TOKEN e SITE_ORIGIN como secrets/vars.
const STATUS = new Set(['Recebida','Em triagem','Em análise','Encaminhada','Aguardando retorno','Concluída','Não acolhida']);
const MAX_BODY = 15000;
function clean(v,max){return typeof v==='string'?v.trim().slice(0,max):'';}
function json(data,status,env,request){
 const origin=request.headers.get('Origin');
 const h=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Vary':'Origin'});
 if(origin && origin===env.SITE_ORIGIN){h.set('Access-Control-Allow-Origin',origin);h.set('Access-Control-Allow-Methods','POST, OPTIONS');h.set('Access-Control-Allow-Headers','Content-Type, Authorization');}
 return new Response(JSON.stringify(data),{status:status||200,headers:h});
}
async function body(req){const raw=await req.text();if(raw.length>MAX_BODY)throw Error('Excesso de dados');const obj=JSON.parse(raw);if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('Formato inválido');return obj;}
function bearer(req){const h=req.headers.get('Authorization')||'';return h.startsWith('Bearer ')?h.slice(7):'';}
function safeEqual(a,b){if(typeof a!=='string'||typeof b!=='string')return false;let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0;}
function randomCode(bytes=32){const b=crypto.getRandomValues(new Uint8Array(bytes));return btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function hash(s){const buff=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return Array.from(new Uint8Array(buff)).map(x=>x.toString(16).padStart(2,'0')).join('');}
async function findSubmission(env,protocol){return env.DB.prepare('SELECT id,protocol,access_hash,title,status,next_step,created_at,updated_at,email,details,category FROM submissions WHERE protocol=?').bind(protocol).first();}
async function history(env,id){return (await env.DB.prepare('SELECT status,public_note AS note,next_step,created_at AS date FROM updates WHERE submission_id=? ORDER BY id ASC').bind(id).all()).results||[];}
export default {
 async fetch(request,env){
  const pathname=new URL(request.url).pathname;
  if(request.method==='OPTIONS'){if(request.headers.get('Origin')!==env.SITE_ORIGIN)return new Response(null,{status:403});return json({},204,env,request);}
  if(pathname==='/api/health' && request.method==='GET')return json({service:'protocolos',status:'online'},200,env,request);
  if(request.method!=='POST'||!pathname.startsWith('/api/'))return json({error:'Rota não encontrada'},404,env,request);
  if(!env.DB||!env.ADMIN_TOKEN||!env.INGEST_TOKEN||!env.SITE_ORIGIN)return json({error:'Serviço ainda não configurado'},503,env,request);
  let b;try{b=await body(request);}catch(e){return json({error:'Dados inválidos'},400,env,request);}
  try{
   if(pathname==='/api/intake'){
    if(!safeEqual(bearer(request),env.INGEST_TOKEN))return json({error:'Acesso negado'},401,env,request);
    const formId=clean(b.form_id,180),email=clean(b.email,200).toLowerCase(),title=clean(b.title,180),category=clean(b.category,80),details=clean(b.details,3500);
    if(!formId||!title||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:'Formulário incompleto'},400,env,request);
    const exists=await env.DB.prepare('SELECT id FROM submissions WHERE form_id=?').bind(formId).first();
    if(exists)return json({error:'Envio já processado; confira se o e-mail foi entregue antes de repetir'},409,env,request);
    const protocol='JA-'+new Date().getUTCFullYear()+'-'+randomCode(9).toUpperCase();
    const accessKey=randomCode(32);
    const accessHash=await hash('v1:'+protocol+':'+accessKey);
    await env.DB.batch([
     env.DB.prepare("INSERT INTO submissions (form_id,protocol,access_hash,email,title,details,category,status,next_step,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'Recebida','A equipe fará a triagem inicial.',datetime('now'),datetime('now'))").bind(formId,protocol,accessHash,email,title,details,category),
     env.DB.prepare("INSERT INTO updates (submission_id,status,public_note,next_step,created_at) SELECT id,'Recebida','Sua sugestão foi registrada e aguarda triagem.','A equipe fará a triagem inicial.',datetime('now') FROM submissions WHERE protocol=?").bind(protocol)
    ]);
    return json({protocol,access_key:accessKey},201,env,request); // chave devolvida uma única vez ao Apps Script para envio por e-mail
   }
   if(pathname==='/api/consultar'){
    const protocol=clean(b.protocol,80).toUpperCase(),key=clean(b.access_key,150);
    if(!protocol||!key)return json({error:'Credenciais obrigatórias'},400,env,request);
    const row=await findSubmission(env,protocol);
    if(!row||!safeEqual(await hash('v1:'+protocol+':'+key),row.access_hash))return json({error:'Credenciais inválidas'},401,env,request);
    const events=await history(env,row.id);
    return json({protocol:row.protocol,title:row.title,status:row.status,next:row.next_step,date:row.created_at,updated_at:row.updated_at,events},200,env,request);
   }
   if(pathname.startsWith('/api/admin/')){
    if(!safeEqual(bearer(request),env.ADMIN_TOKEN))return json({error:'Acesso negado'},401,env,request);
    if(pathname==='/api/admin/listar'){
     const list=(await env.DB.prepare('SELECT protocol,title,status,category,created_at,updated_at FROM submissions ORDER BY id DESC LIMIT 150').all()).results||[];
     return json({items:list},200,env,request);
    }
    if(pathname==='/api/admin/ler'){
     const row=await findSubmission(env,clean(b.protocol,80).toUpperCase());
     if(!row)return json({error:'Não encontrado'},404,env,request);
     const events=await history(env,row.id);
     return json({protocol:row.protocol,title:row.title,details:row.details,category:row.category,email:row.email,status:row.status,next:row.next_step,events},200,env,request);
    }
    if(pathname==='/api/admin/atualizar'){
     const protocol=clean(b.protocol,80).toUpperCase(),status=clean(b.status,70),note=clean(b.public_note,600),next=clean(b.next_step,180);
     if(!STATUS.has(status)||!note||!next)return json({error:'Atualização incompleta'},400,env,request);
     const row=await env.DB.prepare('SELECT id FROM submissions WHERE protocol=?').bind(protocol).first();
     if(!row)return json({error:'Protocolo não encontrado'},404,env,request);
     await env.DB.batch([
      env.DB.prepare("UPDATE submissions SET status=?,next_step=?,updated_at=datetime('now') WHERE id=?").bind(status,next,row.id),
      env.DB.prepare("INSERT INTO updates (submission_id,status,public_note,next_step,created_at) VALUES (?,?,?,?,datetime('now'))").bind(row.id,status,note,next)
     ]);
     return json({ok:true},200,env,request);
    }
   }
   return json({error:'Rota não encontrada'},404,env,request);
  }catch(error){console.error('Erro interno no sistema de protocolos:',error.message);return json({error:'Erro interno. Tente novamente mais tarde.'},500,env,request);}
 }
};