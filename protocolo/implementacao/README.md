# Integração de protocolos — João Assink

Última revisão: novembro de 2026.

## Situação atual (não confundir código pronto com serviço já ativo)

O site público no GitHub Pages já possui:
- consulta /protocolo/ (com exemplos fictícios para testes);
- formulário sem identificação em /protocolo/enviar/;
- painel de gestão da equipe em /protocolo/admin/;
- link para o Google Forms fornecido pelo responsável;
- configuração pública em /protocolo/config.js (contendo URLs e uma sitekey pública, sem secrets).
- Worker privado, esquema D1 e Apps Script preparados neste diretório.

**Não há conexão de produção enquanto as configurações e credenciais da conta Cloudflare e do Google Forms não forem ativadas pelo titular.** Com apiBase e turnstileSiteKey vazios, o envio real fica intencionalmente desabilitado. Não inserir dados reais ou denúncias no protótipo.

## Os dois caminhos de participação

### Com e-mail — Google Forms

A pessoa preenche o formulário Google indicado:
https://docs.google.com/forms/d/e/1FAIpQLSeutZdSqVwU8gfnqKWFVvTNx9V-o_G3PCDq1JSM5NU8u4s5-g/viewform

O Forms **deve estar configurado para coletar e-mail do respondente**. O gatilho Apps Script envia os campos ao Worker em POST /api/intake usando secret INGEST_TOKEN. O Worker grava o registro em D1, gera protocolo único e chave aleatória, guarda somente o hash da chave e devolve os dois ao Apps Script. O Apps Script envia o protocolo e chave no e-mail do respondente. A cada dez minutos, outro gatilho consulta atualizações pendentes e envia avisos de andamento. Os avisos exigem que os limites/quota do MailApp sejam suficientes.

**O Google Forms não revela um código único de confirmação automaticamente na tela de cada respondente.** Ele também não oferece anonimato completo quando está configurado para coletar e-mails.

### Sem identificação — formulário direto do site

A pessoa acessa /protocolo/enviar/, não fornece nome nem e-mail, informa somente categoria, título e descrição. O navegador obtém token de segurança do Turnstile; o Worker valida no endpoint Siteverify de Cloudflare, registra o conteúdo e retorna protocolo e chave à tela. A pessoa precisa copiá-los ou imprimir a confirmação. Sem e-mail não há recuperação automática de chave nem notificações por e-mail. A pessoa consulta posteriormente com ambas as informações.

NÃO prometemos anonimato absoluto: metadados de conexão são processados pelos provedores de rede e segurança; o próprio texto digitado pode permitir identificação. O projeto não grava deliberadamente nome/e-mail na tabela nos envios anônimos, nem o servidor grava explicitamente endereços IP.

## Configuração do banco e do Worker (somente pelo titular autenticado)

1. No Cloudflare, criar **novo Worker** e **novo banco D1** para João Assink. Não reutilizar o Worker/banco da FRESUNI, para manter controles e dados separados.
2. Vincular o banco D1 ao Worker com binding chamado DB.
3. Executar o conteúdo do schema.sql dentro do D1 (SQL console ou Wrangler execute). O esquema pressupõe banco novo. Para um banco já existente deve-se fazer migração por ALTER TABLE: email removendo restrição NOT NULL via rebuild da tabela e updates adicionando notified_at (não tentar reutilizar esquema antigo sem migração).
4. Implantar o arquivo worker.js no Cloudflare (ou usar Wrangler com configuração de banco adequada).
5. Definir SITE_ORIGIN como exatamente https://jassinks.github.io (não incluir caminho /agenteacreditajoaoassink).
6. Em Worker → Settings → Variables/Secrets, guardar **INGEST_TOKEN**, **ADMIN_TOKEN**, **ACCESS_PEPPER** como secretos diferentes, aleatórios e longos; não colocar os valores no repositório nem no ChatGPT.
7. Criar site Turnstile para o hostname jassinks.github.io, registrar a **sitekey pública** e a **secret key** separadamente. Adicionar TURNSTILE_SECRET como secret do Worker. É obrigatório validar Siteverify; o Worker já inclui essa verificação.
8. Implantar Worker e conferir GET /api/health: ready=true informa que a configuração base está completa (não substitui testes).
9. Preencher apiBase em /protocolo/config.js com o URL HTTPS público do Worker, sem barra final, e turnstileSiteKey com a chave pública de Turnstile. **Nunca** preencher secrets nesse arquivo.
10. Configurar regras de mitigação de abuso/rate limiting dos endpoints públicos e de administrador no dashboard da Cloudflare, e controlar permissões de acesso da equipe. Para produção com dados reais, usar autenticação individual com MFA (por exemplo, Cloudflare Access), audit log, política de retenção e tratamento de incidentes. A credencial administrativa única fornecida no exemplo deve ser substituída por controle de identidade individual na operação em produção.
11. Fazer testes de envio e consulta com exemplos fictícios; depois revisar política de privacidade e capacidade de atendimento antes de liberar ao público.

## Instalação do Google Apps Script (somente pelo proprietário/editor do formulário)

1. Abra o formulário em modo de edição (não apenas o link público /viewform), e certifique-se de que ele está publicado e permite respostas.
2. Em Configurações → Respostas, ativar a coleta de endereços de e-mail. Desativar coleta automática de e-mail da conta, se preferir entrada manual, mas ainda será necessário coletar um e-mail válido de contato. Se o formulário exigir login Google, esclareça isso ao participante.
3. Abrir Editor do Apps Script a partir do formulário, copiar google-apps-script.js.
4. Executar verificarFormulario(): examinar os nomes reais das perguntas no registro de execução. Ajustar FIELDS.title, FIELDS.details e FIELDS.category conforme os títulos exatos (a página pública não permite conferir os títulos com segurança).
5. No Apps Script → Propriedades do script: WORKER_URL (URL pública do Worker) e INGEST_TOKEN (igual ao secret do Worker).
6. Executar instalarGatilhos() **uma vez** e aprovar as permissões para acessar Forms, realizar chamadas URL e enviar e-mails.
7. Enviar uma resposta de teste com seu próprio endereço; conferir a chegada do protocolo e chave e o status visível no site. Atualizar um registro pelo painel e aguardar o próximo agendamento do envio de avisos de andamento.
8. Conferir limites do MailApp, a caixa de spam, respostas com campos em branco e registros de falha nos logs de execução.

Observação: não recebemos autorização/acesso autenticado ao editor do Google Forms nem às credenciais Cloudflare por esta conversa; arquivos de código não implantam esses serviços automaticamente.

## Segurança e privacidade

- Não publicar em GitHub qualquer resposta real de formulário, nome, e-mail, dados de saúde, endereço, token ou chave.
- A consulta exige protocolo e segredo distintos, verificados no Worker. A equipe possui autenticação à parte.
- O front-end utiliza textContent para mostrar conteúdos enviados, sem HTML dinâmico.
- Chaves não são colocadas em URLs, logs do navegador nem localStorage.
- O fluxo de envio sem identificação pede que a pessoa não inclua dados de terceiros.
- Os dados no D1 devem ser usados apenas para fins informados ao titular, com prazo de guarda e exclusão planejados.
- Antes da abertura do serviço, elaborar aviso de privacidade (finalidade, controlador, canal de direitos, retenção e compartilhamentos), definir bases legais e tratar eventual dado sensível com cautela, em conformidade com a LGPD.
- Este serviço é independente e pessoal, não um canal da Câmara Municipal, de governo, de polícia ou de urgência.

## URLs de referência oficial

- https://support.google.com/docs/answer/139706?hl=pt-BR
- https://developers.google.com/apps-script/reference/forms/form
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- https://developers.cloudflare.com/d1/
- https://www.gov.br/anpd/pt-br
