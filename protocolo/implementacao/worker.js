/**
 * Serviço privado de protocolos João Assink — Cloudflare Worker + D1.
 * NUNCA colocar tokens, dados pessoais ou chaves de consulta no GitHub Pages.
 * Para ativar: ver README.md. Requer DB, SITE_ORIGIN, INGEST_TOKEN e ADMIN_TOKEN.
 */
const STATUS = new Set(['Recebida','Em triagem','Em análise','Encaminhada','Aguardando retorno','Concluída','Não acolhida']);
const MAX_BODY = 16000;
const MAX_NOTIFICATIONS = 25;
const enc = new TextEncoder();
const clean = (v,max=200)=>typeof v==='string'?v.trim().slice(0,max):'';
const json = (data, status, env, request) => {
  const h = new Headers({
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'private, no-store, max-age=0',
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY',
    'Referrer-Policy':'no-referrer',
    'Vary':'Origin'
  });
  const origin=request.headers.get('Origin');
  if(origin && origin===env.SITE_ORIGIN){
    h.set('Access-Control-Allow-Origin',origin);
    h.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');
    h.set('Access-Control-Allow-Headers','Content-Type, Authorization');
  }
  return new Response(JSON.stringify(data),{status,headers:h});
};
function equal(a,b){
  if(typeof a!=='string'||typeof b!=='string')return false;
  let diff=a.length ^ b.length;
  for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0) ^ (b.charCodeAt(i)||0);
  return diff===0;
}
function authorized(req,secret){
  const auth=req.headers.get('Authorization')||'';
  return auth.startsWith('Bearer ')&&secret&&equal(auth.slice(7),secret);
}
function secureToken(n=32){
  const a=crypto.getRandomValues(new Uint8Array(n));
  return btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function digest(str){
  const bytes=await crypto.subtle.digest('SHA-256',enc.encode(str));
  return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
const keyHash=(p,k,pepper)=>digest('JA-KEY-v1:'+p+':'+k+':'+pepper);
async function parse(req){
  if((req.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase()!=='application/json')throw Error('content-type');
  if(Number(req.headers.get('Content-Length')||0)>MAX_BODY)throw Error('size');
  const raw=await req.text();
  if(raw.length>MAX_BODY)throw Error('size');
  const o=JSON.parse(raw);
  if(!o || typeof o!=='object' || Array.isArray(o))throw Error('object');
  return o;
}
async function history(env,id){
  const rows=await env.DB.prepare('SELECT status, public_note AS note, next_step, created_at AS date FROM updates WHERE submission_id=? ORDER BY id ASC').bind(id).all();
  return rows.results||[];
}
async function submission(env,p){
  return env.DB.prepare('SELECT id,form_id,protocol,access_hash,email,title,details,category,status,next_step,created_at,updated_at FROM submissions WHERE protocol=?').bind(p).first();
}
export default {
  async fetch(req,env){
    const path=new URL(req.url).pathname.replace(/\/+$/,'')||'/';
    if(req.method==='OPTIONS'){
      if(req.headers.get('Origin')!==env.SITE_ORIGIN)return new Response(null,{status:403});
      return new Response(null,{status:204,headers:{
        'Access-Control-Allow-Origin':env.SITE_ORIGIN,
        'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers':'Content-Type, Authorization',
        'Access-Control-Max-Age':'600',
        'Cache-Control':'no-store',
        'Vary':'Origin'
      }});
    }
    if(path==='/api/health'&&req.method==='GET'){
      return json({service:'joao-assink-protocolos',ready:!!(env.DB&&env.ADMIN_TOKEN&&env.INGEST_TOKEN&&env.ACCESS_PEPPER&&env.SITE_ORIGIN)},200,env,req);
    }
    if(req.method!=='POST'||!path.startsWith('/api/'))return json({error:'Não encontrado'},404,env,req);
    if(!env.DB||!env.ADMIN_TOKEN||!env.INGEST_TOKEN||!env.ACCESS_PEPPER||!env.SITE_ORIGIN){
      return json({error:'Serviço não configurado'},503,env,req);
    }
    if(req.headers.get('Origin')&&req.headers.get('Origin')!==env.SITE_ORIGIN){
      return json({error:'Origem não autorizada'},403,env,req);
    }
    let b;
    try{b=await parse(req);}catch(e){return json({error:'Dados inválidos ou muito grandes'},400,env,req);}
    try{
      // Cadastro anônimo a partir do próprio site.
      // Turnstile Siteverify é obrigatório; o Worker não armazena e-mail ou nome.
      if(path==='/api/public/create'){
        if(!env.TURNSTILE_SECRET) return json({error:'Cadastro anônimo ainda não configurado'},503,env,req);
        const title=clean(b.title,180),details=clean(b.details,3500),category=clean(b.category,80);
        const challenge=clean(b.turnstile_token,2048);
        if(title.length<5||details.length<15||!challenge){
          return json({error:'Informe assunto, descrição e verificação de segurança'},400,env,req);
        }
        let validated;
        try {
          const verify=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
            method:'POST',
            headers:{'Content-Type':'application/x-www-form-urlencoded'},
            body:new URLSearchParams({secret:env.TURNSTILE_SECRET,response:challenge})
          });
          validated=await verify.json();
        }catch(e){
          return json({error:'Não foi possível validar o envio. Tente novamente.'},503,env,req);
        }
        const hostname=new URL(env.SITE_ORIGIN).hostname;
        if(!validated?.success||validated.hostname!==hostname||validated.action!=='anon_sugestao'){
          return json({error:'Verificação de segurança não aprovada. Atualize a página e tente novamente.'},403,env,req);
        }
        const formId='site-'+crypto.randomUUID();
        const protocol='JA-'+new Date().getUTCFullYear()+'-'+secureToken(9).toUpperCase();
        const accessKey=secureToken(32);
        await env.DB.batch([
          env.DB.prepare("INSERT INTO submissions (form_id,protocol,access_hash,email,title,details,category,status,next_step,created_at,updated_at) VALUES (?,?,?,NULL,?,?,?,'Recebida','A equipe fará a triagem inicial.',datetime('now'),datetime('now'))")
            .bind(formId,protocol,await keyHash(protocol,accessKey,env.ACCESS_PEPPER),title,details,category),
          env.DB.prepare("INSERT INTO updates (submission_id,status,public_note,next_step,created_at,notified_at) SELECT id,'Recebida','Sua sugestão anônima foi registrada e aguarda triagem.','A equipe fará a triagem inicial.',datetime('now'),datetime('now') FROM submissions WHERE protocol=?").bind(protocol)
        ]);
        return json({protocol,access_key:accessKey,anonymous:true,save_key_notice:'Guarde esta chave. Sem e-mail cadastrado não será possível recuperá-la.'},201,env,req);
      }
      // Chamado apenas pelo Google Apps Script, autenticado por INGEST_TOKEN.
      if(path==='/api/intake'){
        if(!authorized(req,env.INGEST_TOKEN))return json({error:'Não autorizado'},401,env,req);
        const formId=clean(b.form_id,180),email=clean(b.email,200).toLowerCase();
        const title=clean(b.title,180),category=clean(b.category,80);
        const details=clean(b.details,3500);
        if(!formId||!title||!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
          return json({error:'Envio incompleto'},400,env,req);
        }
        const old=await env.DB.prepare('SELECT id,protocol,email FROM submissions WHERE form_id=?').bind(formId).first();
        const key=secureToken(32);
        if(old){
          // Caso a notificação inicial falhe, o Apps Script pode repetir o envio:
          // a chave anterior é invalidada, e uma nova é entregue ao e-mail informado.
          // O formulário já enviado não produz um segundo protocolo.
          if(old.email!==email)return json({error:'E-mail divergente em reenvio; revisão necessária'},409,env,req);
          await env.DB.prepare("UPDATE submissions SET access_hash=?,updated_at=datetime('now') WHERE id=?")
            .bind(await keyHash(old.protocol,key,env.ACCESS_PEPPER),old.id).run();
          return json({protocol:old.protocol,access_key:key,reissued:true},200,env,req);
        }
        const protocol='JA-'+new Date().getUTCFullYear()+'-'+secureToken(9).toUpperCase();
        const digestKey=await keyHash(protocol,key,env.ACCESS_PEPPER);
        await env.DB.batch([
          env.DB.prepare("INSERT INTO submissions (form_id,protocol,access_hash,email,title,details,category,status,next_step,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'Recebida','A equipe fará a triagem inicial.',datetime('now'),datetime('now'))")
            .bind(formId,protocol,digestKey,email,title,details,category),
          env.DB.prepare("INSERT INTO updates (submission_id,status,public_note,next_step,created_at,notified_at) SELECT id,'Recebida','Sua sugestão foi registrada e aguarda triagem.','A equipe fará a triagem inicial.',datetime('now'),datetime('now') FROM submissions WHERE protocol=?").bind(protocol)
        ]);
        return json({protocol,access_key:key,reissued:false},201,env,req);
      }
      if(path==='/api/consultar'){
        const p=clean(b.protocol,80).toUpperCase(),key=clean(b.access_key,150);
        if(!p||!key)return json({error:'Protocolo e chave obrigatórios'},400,env,req);
        const row=await submission(env,p);
        if(!row || !equal(row.access_hash,await keyHash(p,key,env.ACCESS_PEPPER))){
          return json({error:'Protocolo ou chave inválidos'},401,env,req);
        }
        return json({
          protocol:row.protocol,title:row.title,status:row.status,next:row.next_step,
          date:row.created_at,updated_at:row.updated_at,events:await history(env,row.id)
        },200,env,req);
      }
      // Notificações de atualização: polling do Google Apps Script por timer.
      if(path.startsWith('/api/notifications/')){
        if(!authorized(req,env.INGEST_TOKEN))return json({error:'Não autorizado'},401,env,req);
        if(path==='/api/notifications/pending'){
          const list=await env.DB.prepare("SELECT u.id AS update_id, s.protocol, s.email, u.status, u.created_at AS date FROM updates u JOIN submissions s ON s.id=u.submission_id WHERE u.notified_at IS NULL AND s.email IS NOT NULL AND s.email <> '' ORDER BY u.id ASC LIMIT ?").bind(MAX_NOTIFICATIONS).all();
          return json({items:list.results||[]},200,env,req);
        }
        if(path==='/api/notifications/ack'){
          const id=Number(b.update_id);
          if(!Number.isSafeInteger(id)||id<1)return json({error:'ID inválido'},400,env,req);
          const r=await env.DB.prepare("UPDATE updates SET notified_at=datetime('now') WHERE id=? AND notified_at IS NULL").bind(id).run();
          return json({ok:true,changed:r.meta?.changes||0},200,env,req);
        }
      }
      if(path.startsWith('/api/admin/')){
        if(!authorized(req,env.ADMIN_TOKEN))return json({error:'Não autorizado'},401,env,req);
        if(path==='/api/admin/listar'){
          const list=await env.DB.prepare('SELECT protocol,title,category,status,created_at,updated_at FROM submissions ORDER BY id DESC LIMIT 150').all();
          return json({items:list.results||[]},200,env,req);
        }
        if(path==='/api/admin/ler'){
          const row=await submission(env,clean(b.protocol,80).toUpperCase());
          if(!row)return json({error:'Protocolo não encontrado'},404,env,req);
          return json({
            protocol:row.protocol,title:row.title,details:row.details,category:row.category,
            email:row.email,status:row.status,next:row.next_step,events:await history(env,row.id)
          },200,env,req);
        }
        if(path==='/api/admin/atualizar'){
          const protocol=clean(b.protocol,80).toUpperCase(),status=clean(b.status,70);
          const note=clean(b.public_note,600),next=clean(b.next_step,180);
          if(!STATUS.has(status)||!note||!next)return json({error:'Campos obrigatórios ausentes'},400,env,req);
          const row=await submission(env,protocol);
          if(!row)return json({error:'Protocolo não encontrado'},404,env,req);
          await env.DB.batch([
            env.DB.prepare("UPDATE submissions SET status=?,next_step=?,updated_at=datetime('now') WHERE id=?").bind(status,next,row.id),
            env.DB.prepare("INSERT INTO updates (submission_id,status,public_note,next_step,created_at,notified_at) VALUES (?,?,?,?,datetime('now'),NULL)").bind(row.id,status,note,next)
          ]);
          return json({ok:true,notification_queued:true},200,env,req);
        }
        if(path==='/api/admin/excluir'){
          const row=await submission(env,clean(b.protocol,80).toUpperCase());
          if(!row)return json({error:'Protocolo não encontrado'},404,env,req);
          if(clean(b.confirm,12)!=='EXCLUIR')return json({error:'Confirmação obrigatória'},400,env,req);
          await env.DB.batch([
            env.DB.prepare('DELETE FROM updates WHERE submission_id=?').bind(row.id),
            env.DB.prepare('DELETE FROM submissions WHERE id=?').bind(row.id)
          ]);
          return json({ok:true},200,env,req);
        }
      }
      return json({error:'Rota não encontrada'},404,env,req);
    }catch(e){
      console.error('Erro técnico de protocolo:',e.name||'Error');
      return json({error:'Erro interno. Tente novamente mais tarde.'},500,env,req);
    }
  }
};
