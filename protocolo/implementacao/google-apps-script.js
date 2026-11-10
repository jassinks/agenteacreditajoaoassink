/**
 * Google Apps Script, instale pelo editor do Google Forms.
 * Integrações: envio do protocolo ao e-mail de quem preenche o Forms
 * e notificações de novas movimentações feitas pela equipe.
 *
 * IMPORTANTE: use o Forms somente para quem aceita informar e-mail.
 * Para envio sem identificação, use /protocolo/enviar/ (sem Google Forms).
 *
 * Antes de ativar:
 * 1. No Forms: ativar "Coletar endereços de e-mail" e publicar.
 * 2. Preencher os títulos EXATOS das perguntas no FIELDS abaixo.
 * 3. Criar Script Properties: WORKER_URL e INGEST_TOKEN.
 * 4. Executar verificarFormulario() para ver títulos, depois instalarGatilhos().
 * 5. Enviar uma resposta de TESTE com seu próprio e-mail.
 *
 * Não incluir dados reais, segredos, token, e-mail de cidadãos no GitHub.
 */
const FIELDS = Object.freeze({
  title: 'Qual é o assunto da sugestão?',
  details: 'Descreva sua sugestão',
  category: 'Categoria'
});
const PORTAL_URL='https://jassinks.github.io/agenteacreditajoaoassink/protocolo/';
function props(){
  const p=PropertiesService.getScriptProperties();
  const url=p.getProperty('WORKER_URL'),token=p.getProperty('INGEST_TOKEN');
  if(!url||!token)throw new Error('Configure WORKER_URL e INGEST_TOKEN em Propriedades do script.');
  return {url:url.replace(/\/$/,''),token:token};
}
function callWorker(route,data){
  const conf=props();
  const response=UrlFetchApp.fetch(conf.url+route,{
    method:'post',
    contentType:'application/json',
    headers:{Authorization:'Bearer '+conf.token},
    payload:JSON.stringify(data),
    muteHttpExceptions:true
  });
  const status=response.getResponseCode();
  if(status<200||status>=300){
    // Não registrar informações pessoais em logs.
    throw new Error('Worker retornou HTTP '+status+' em '+route+'.');
  }
  return JSON.parse(response.getContentText());
}
function verificarFormulario(){
  const form=FormApp.getActiveForm();
  if(!form)throw new Error('Abra este Apps Script dentro do próprio Google Forms.');
  Logger.log('Formulário: '+form.getTitle());
  Logger.log('Coleta e-mail: '+(form.collectsEmail()?'SIM':'NÃO. ATIVE NAS CONFIGURAÇÕES.'));
  form.getItems().forEach(item=>Logger.log('Pergunta: '+item.getTitle()));
  Logger.log('Confirme que FIELDS corresponde exatamente aos títulos acima.');
}
function instalarGatilhos(){
  const form=FormApp.getActiveForm();
  if(!form)throw new Error('Instale este script a partir do Google Forms.');
  if(!form.collectsEmail())throw new Error('Ative coleta de endereço de e-mail no Forms.');
  props();
  const handlers=['aoEnviarFormulario','enviarAvisosDeAndamento'];
  ScriptApp.getProjectTriggers().forEach(t=>{
    if(handlers.indexOf(t.getHandlerFunction())!==-1)ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('aoEnviarFormulario').forForm(form).onFormSubmit().create();
  ScriptApp.newTrigger('enviarAvisosDeAndamento').timeBased().everyMinutes(10).create();
  Logger.log('Gatilhos instalados. Faça um envio de teste real.');
}
function aoEnviarFormulario(e){
  if(!e||!e.response)throw new Error('A função precisa ser chamada pelo envio do Forms.');
  const resposta=e.response;
  const email=resposta.getRespondentEmail();
  if(!email)throw new Error('E-mail ausente: habilite a coleta no Forms.');
  const campos={};
  resposta.getItemResponses().forEach(r=>{
    campos[r.getItem().getTitle()] = String(r.getResponse()||'').trim();
  });
  const title=campos[FIELDS.title]||'';
  const details=campos[FIELDS.details]||'';
  const category=campos[FIELDS.category]||'Sugestão';
  if(!title||!details)throw new Error('Os títulos das perguntas não coincidem com FIELDS. Execute verificarFormulario().');
  const result=callWorker('/api/intake',{
    form_id:resposta.getId(),
    email:email,
    title:title,
    details:details,
    category:category
  });
  if(!result.protocol||!result.access_key)throw new Error('Resposta de protocolo incompleta.');
  // O envio do Forms não pode mostrar uma mensagem personalizada com a chave.
  // Ela é enviada diretamente ao e-mail informado no formulário.
  MailApp.sendEmail({
    to:email,
    subject:'Seu protocolo de sugestão — João Assink',
    body:'Olá!\n\nSua sugestão foi registrada no sistema de acompanhamento de João Assink.\n\n'+
      'NÚMERO DE PROTOCOLO: '+result.protocol+'\n'+
      'CHAVE PRIVADA: '+result.access_key+'\n\n'+
      'Acompanhe o andamento em: '+PORTAL_URL+'\n\n'+
      'Guarde estas informações. O protocolo sozinho não permite acesso.\n\n'+
      'Este é um canal pessoal independente, não um serviço oficial de órgão público.'
  });
}
function enviarAvisosDeAndamento(){
  // Execução periódica. Se o e-mail falhar, a atualização continua pendente.
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(25000))return;
  try{
    const pending=callWorker('/api/notifications/pending',{});
    const records=pending.items||[];
    for(let i=0;i<records.length;i++){
      const item=records[i];
      if(!item.email||!item.protocol||!item.update_id)continue;
      if(MailApp.getRemainingDailyQuota()<1)break;
      MailApp.sendEmail({
        to:item.email,
        subject:'Atualização da sua sugestão — '+item.protocol,
        body:'Olá!\n\nSeu protocolo '+item.protocol+' recebeu uma atualização.\n'+
          'Situação: '+item.status+'\nData: '+item.date+'\n\n'+
          'Para ver a devolutiva e o próximo passo, acesse: '+PORTAL_URL+'\n\n'+
          'Será necessário informar seu protocolo e chave privada.\n\n'+
          'Esta mensagem é de uma iniciativa pessoal e independente.'
      });
      callWorker('/api/notifications/ack',{update_id:item.update_id});
    }
  } finally {
    lock.releaseLock();
  }
}
