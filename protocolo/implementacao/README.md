# Sistema de protocolos João Assink — modelo e futura implantação

## O que está publicado
- /protocolo/ é uma demonstração pública com dois registros inteiramente fictícios. Qualquer pessoa pode inspecionar os códigos do JavaScript e os exemplos. Não é seguro para dados reais.
- A partir do site João Assink, o acesso foi acrescentado à seção "Chegou a Tua Vez".
- /protocolo/admin/ é a interface administrativa preparada para uma futura API. Não está habilitada sem servidor.
- Google Forms, entrega real de e-mails, armazenamento e consultas privadas não estão conectados ainda.

Não cadastrar dados pessoais reais, informações de saúde ou denúncias neste protótipo.

## Arquitetura para o serviço privado

Google Forms (coleta de e-mail) → gatilho do Google Apps Script → POST /api/intake no Cloudflare Worker (autenticado com INGEST_TOKEN) → banco Cloudflare D1.

Ao receber o formulário, o Worker:
1. impede duplicação do mesmo ID de resposta;
2. gera protocolo não sequencial e chave de acesso aleatória de 256 bits;
3. guarda no banco apenas o SHA-256 da chave vinculada ao protocolo;
4. registra a primeira movimentação;
5. devolve o protocolo e a chave uma única vez ao Apps Script, que os envia ao e-mail do formulário.

O cidadão consulta no site com protocolo + chave. Apenas o Worker verifica a chave e devolve os dados do protocolo correspondente. Nenhuma lista completa é pública.

A equipe acessa /protocolo/admin/ com credencial administrativa separada e consulta/atualiza o banco pelo Worker. Nunca usar token da equipe no HTML público nem compartilhar chaves entre usuários.

## Para habilitar tecnicamente

1. Criar um novo Worker da Cloudflare para este projeto. Não misturar com o Worker ou banco da FRESUNI.
2. Criar banco D1 privado e executar o arquivo schema.sql no console SQL do banco.
3. Adicionar ao Worker uma ligação D1 chamada exatamente DB.
4. Copiar worker.js para o código do Worker ou publicar via Wrangler.
5. Configurar SITE_ORIGIN = https://jassinks.github.io. O valor é a origem, não a URL com o caminho da página.
6. Configurar como Secrets INGEST_TOKEN e ADMIN_TOKEN, ambos diferentes, longos, aleatórios e gerados fora deste repositório (por exemplo, dois valores de 32 bytes cada). Não incluir valores reais em commits.
7. Implantar o Worker e testar o endpoint /api/health.
8. Após confirmar HTTPS e domínio do Worker, preencher somente a URL pública da API na constante API_BASE de protocolo/index.html e protocolo/admin/index.html. Não preencher tokens nesses arquivos.
9. Criar ou editar um Google Forms para coletar e-mail, assunto, descrição e, se necessário, categoria. Conectar script de google-apps-script.js ao formulário, ajustar FIELDS, cadastrar nas propriedades do script WORKER_URL e INGEST_TOKEN. Executar instalarGatilho() uma vez e autorizar; fazer um envio de teste.
10. Confirmar que o e-mail recebido contém protocolo e chave; confirmar também que código sozinho, chave errada ou outro código não retornam detalhes.
11. Configurar regras de rate limiting / mitigação de abuso no Cloudflare para /api/consultar, /api/admin/* e /api/intake; restringir permissões administrativas e revisar registros de acesso.
12. Antes de receber casos reais, publicar aviso de privacidade, definir controlador, finalidade, base legal, prazo de retenção, canal para direitos do titular, política de exclusão e resposta a incidentes. Avaliar tratamentos de dados sensíveis e de menores com apoio jurídico.

## O que esta versão não faz
- Não cria nem instala Cloudflare Worker, D1, Script ou Google Forms automaticamente.
- Não cria credenciais de produção para terceiros.
- Não envia notificações automáticas a cada alteração de status: o exemplo envia o primeiro e-mail com o código e chave. É possível integrar notificações futuras depois de implementar e validar um serviço de envio.
- Não implementa recuperação de chave perdida; a recuperação deve revalidar o e-mail e revogar a chave antiga.
- Não implementa login por e-mail com código temporário (OTP), auditoria administrativa completa, política de retenção ou rate limiting interno: estes devem ser acrescentados para produção.

## Segurança e privacidade
Não é verdade que uma URL ou número de protocolo, por si só, garanta privacidade. O acesso real depende da verificação no Worker: protocolo + chave secreta, ou autenticação administrativa separada.

O código-fonte deste repositório é público. Os dados reais ficam somente no D1, nunca embutidos no HTML, GitHub Pages, JavaScript público, arquivos JSON públicos ou URLs com chaves em parâmetros.

Dados relativos à saúde ou deficiência podem ser dados pessoais sensíveis sob a LGPD (Lei 13.709/2018, artigos 7 e 11). Evitar coleta desnecessária. Este projeto é uma página pessoal independente, não um canal oficial da Câmara ou da Prefeitura, e não deve dar a impressão de que denúncias ou serviços públicos estejam sendo recebidos.

Links oficiais úteis:
- ANPD: https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes
- Google Apps Script: https://developers.google.com/apps-script/guides/triggers/events
- Cloudflare D1: https://developers.cloudflare.com/d1/tutorials/build-an-api-to-access-d1/
- Secrets no Workers: https://developers.cloudflare.com/workers/configuration/secrets/
