/**
 * EXEMPLO para Google Apps Script vinculado ao Google Forms.
 * 1) Configure no formulário: "Coletar endereços de e-mail".
 * 2) Ajuste os três títulos de perguntas em FIELDS abaixo.
 * 3) Nas propriedades do script: WORKER_URL e INGEST_TOKEN.
 * 4) Execute instalarGatilho() UMA VEZ, autorizando as permissões.
 * Nunca coloque as credenciais do Worker no HTML público nem neste arquivo versionado.
 */
const FIELDS = Object.freeze({
 title:'Qual é o assunto da sugestão?',
 details:'Descreva sua sugestão',
 category:'Categoria'
});
function instalarGatilho(){
 const form=FormApp.getActiveForm();
 ScriptApp.newTrigger('aoEnviarFormulario').forForm(form).onFormSubmit().create();
}
function aoEnviarFormulario(e){
 if(!e || !e.response)throw Error('Necessário envio real do formulário.');
 const props=PropertiesService.getScriptProperties();
 const base=props.getProperty('WORKER_URL');
 const token=props.getProperty('INGEST_TOKEN');
 if(!base || !token)throw Error('Configure WORKER_URL e INGEST_TOKEN nas propriedades.');
 const resposta=e.response;
 const email=resposta.getRespondentEmail();
 if(!email)throw Error('Ative a coleta obrigatória de e-mail no formulário.');
 const campos={};
 resposta.getItemResponses().forEach(r=>campos[r.getItem().getTitle()]=String(r.getResponse()||''));
 const body={
  form_id:resposta.getId()||Utilities.getUuid(),
  email:email,
  title:campos[FIELDS.title]||'Sugestão enviada',
  details:campos[FIELDS.details]||'',
  category:campos[FIELDS.category]||'Sugestão'
 };
 const url=base.replace(/\/$/,'')+'/api/intake';
 const response=UrlFetchApp.fetch(url,{
  method:'post',
  contentType:'application/json',
  headers:{Authorization:'Bearer '+token},
  payload:JSON.stringify(body),
  muteHttpExceptions:true
 });
 const status=response.getResponseCode();
 if(status!==201)throw Error('Falha ao registrar protocolo. HTTP '+status+' (verificar logs da automação).');
 const result=JSON.parse(response.getContentText());
 // Envie a chave APENAS ao titular do formulário, por e-mail.
 MailApp.sendEmail({
  to:email,
  subject:'Seu protocolo de acompanhamento · João Assink',
  body:'Olá!\n\nSeu registro foi recebido.\n\nProtocolo: '+result.protocol+'\nChave de acesso: '+result.access_key+
  '\n\nAcompanhe em: https://jassinks.github.io/agenteacreditajoaoassink/protocolo/\n\nGuarde a chave em local seguro. Não compartilhe este e-mail.\n\nEsta página não é um serviço oficial de órgão público.'
 });
}