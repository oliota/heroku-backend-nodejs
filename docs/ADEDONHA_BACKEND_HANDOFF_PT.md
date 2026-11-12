# Ajustes efetivamente realizados — insumo para o prompt do frontend

Este registro descreve os arquivos reais deste backend. Não é uma promessa de serviços externos já configurados. Leia também `docs/ADEDONHA_FRONTEND_INTEGRATION.md`: esse é o contrato detalhado de métodos, corpos, respostas, erros e dados em tempo real.

## 1. O que foi implementado

- Integração no **mesmo Express**, sob `/api/v1/adedonha`, mantendo a porta `process.env.PORT || 3002`, o `Procfile` e as rotas de despesas, agenda e resumo GitHub.
- Firebase Admin com app nomeado `adedonha-stop-admin`, separado do Firebase existente da agenda (`oliota`). Credenciais exclusivamente por ambiente. O servidor inicia mesmo sem elas.
- **49 endpoints registrados**: 6 públicos e 43 protegidos, cobrindo todos os grupos solicitados: usuário, salas, partidas/rodadas, respostas, revisão, amigos, bilhetes e premium.
- Autenticação por Firebase ID token com verificação de revogação e identidade Google; autorização de membro/líder; validação de campos; CORS específico configurável; limites de requisição; erros sanitizados; transações; versões e idempotência persistida.
- Cópia das **regras oficiais compartilhadas do Godot**, com categorias, sugestões, letras, alfabetos, idiomas, pontuação e limites reais. Nenhuma lista inventada.
- Salas com códigos únicos de 5 caracteres, até 10 participantes, líder, configurações, presença, reconexão, saída e fechamento. Saída explícita do líder transfere liderança se houver outro participante presente. O benefício compartilhado premium continua na sala.
- Partida e rodada com IDs próprios; letra selecionada e confirmada persistida pelo servidor. O frontend nunca calcula a letra pela posição visual da roda.
- Respostas privadas durante preenchimento, sequência por jogador/rodada, proteção de resposta final e encerramento imediato após STOP, utilizando os rascunhos já enviados e a resposta final do jogador que acionou STOP. O último rascunho válido não é apagado por mensagem atrasada.
- Sugestão de pontuação 10/5/0 pelas regras do Godot; pontuação definitiva somente depois da revisão.
- Sugestões 0/5/10 aceitas automaticamente; votos explícitos somente em palavras contestadas, exigindo unanimidade dos participantes; bloqueio de aprovação; reabertura exclusiva do líder com nova época; confirmação/retirada de conclusão; avanço por categoria; força pelo voto explícito do líder; consolidação e histórico atômicos.
- Amigos com código de 6 caracteres, pedido, aceite, rejeição, remoção bidirecional, prevenção de duplicidade e contador persistido para badge.
- Bilhetes reais por usuário/sala, intents com expiração, proteção de reutilização, reconexão sem novo consumo e interface de verificação de recompensa desacoplada do provedor.
- **Sem provedor de anúncio habilitado**: criação/entrada utilizam bilhetes gratuitos emitidos pelo servidor. Não existe anúncio fictício nem aceitação de simples declaração do cliente.
- Adaptadores de verificação de compras Google Play e App Store, com produto configurado no servidor, vínculo de conta assinado pela loja, bloqueio de compra em outro UID, restauração e revogação. Google faz acknowledgment; Apple usa a biblioteca oficial e valida assinaturas com raízes Apple.
- Compra permanente da Roda Dourada reconhecida pelo mesmo UID nas plataformas. Comprovantes ficam privados no backend, permitindo revalidar acesso também na Web. A verificação é renovada no acesso depois de uma hora; não há webhook de loja nesta entrega.
- Sala criada por proprietário com licença verificada já inclui sua entrada e ativa o benefício para convidados. O benefício permanece após saída/desconexão e acaba em `finished`/`closed`.
- Regras e índices Firestore **candidatos**, com escrita de jogo protegida pela API e preservação do fluxo nativo de login, feedback e convites. Não foram publicados.
- README em inglês, `.env.example`, contrato completo, comandos npm e testes automatizados.

## 2. Decisões que o prompt do frontend precisa incorporar

### Rotas e URLs

- Implementar futuramente as duas rotas equivalentes `https://oliota.com/adedonha` e `https://oliota.com/stop` no frontend existente.
- Desenvolvimento: `http://localhost:3002/api/v1/adedonha`.
- Produção prevista **depois de deploy manual**: `https://heroku-backend-nodejs-fd16668acdd6.herokuapp.com/api/v1/adedonha`.
- Usar variável de configuração para a base URL; o frontend não foi modificado nesta tarefa.

### Respostas, autenticação e operações

- Sucesso: `{ "data": ... }`. Erro: `{ "error": { "code": "...", "message": "..." } }`.
- Login Google no Firebase `adedonha-stop`; enviar `Authorization: Bearer <Firebase ID token>`. Um token OAuth do Google não substitui o ID token Firebase.
- Toda escrita exige `Idempotency-Key`, de 8–100 caracteres alfanuméricos, `_` ou `-`. Repetir a mesma operação após falha de rede com a mesma chave e mesmo corpo. Não gerar uma chave nova para cada tentativa de rede.
- Alterações de sala exigem `version` atual; operações de rodada/revisão também exigem `game_id` e `round_id`. Exceções documentadas: heartbeat e reconexão de membro existente.
- Após `STALE_VERSION`, buscar `/game`, reconciliar a intenção e emitir uma nova operação com nova chave. Serializar escritas locais e evitar disparar rascunhos em paralelo.
- Nunca enviar UID de autoridade, host, owner, pontos ou `premium:true` para obter permissões. Mostrar e seguir os dados retornados pelo servidor.
- Estados no JSON são **minúsculos**: `lobby`, `letter_selection`, `playing`, `review`, `results`, `finished`, `closed`.

### Configuração e dados de idioma

- Consultar `/config`, `/rules`, `/locales`, `/categories?locale=...` e `/letters?locale=...`.
- Idiomas: `en`, `pt`, `pt_pt`, `es`, `fr`, `de`, `it`, `ru`, `el`, `zh`; aliases `pt_BR` e `pt_PT` são aceitos.
- Categorias são arrays; `letters` e `alphabet` são strings. Não duplicar listas no frontend.
- Respeitar 3–12 categorias, 24 caracteres por categoria, 40 por resposta, 10 jogadores, timers `0/60/90/120/180` e rodadas `1/3/5/7/10`.
- Usar `selected_letter` para a animação e `letter` confirmada para o jogo. Confirmar a mesma letra selecionada pelo servidor.

### Tempo real e reconexão

- Estado inicial e operações pela REST; atualizações com listener Firebase em `rooms/{code}`, somente depois de criar/entrar.
- Não usar servidor WebSocket separado e não gravar diretamente nas coleções de jogo.
- Ao reconectar: renovar token, `/join`, `/game`, substituir estado local, reassinar listener. Deduplicar por `version` e conferir IDs de partida/rodada.
- Enviar heartbeat aproximadamente a cada 25 s. Presença expira visualmente após 60 s sem `last_seen`, mesmo com `present:true` persistido.
- Durante timer/STOP, consultar `/game` aproximadamente a cada segundo até a revisão: listener sozinho não executa a transição temporal do servidor.
- O jogador só lê seu próprio documento de rascunho em `rooms/{code}/players/{uid}`. Retomar a sequência desse documento ao reconectar; não sobrescrever com cache antigo.

### Revisão

- Identificador de categoria é índice numérico iniciado em zero; chave de palavra é `<uid>:<índice>`.
- Voto: `{ "v": 0|5|10, "e": <época> }`, dentro de `votes`.
- Votar na categoria ativa, em todas as palavras, inclusive vazias e na própria. O backend exige voto explícito para vazias; não aplicar a aprovação automática de vazias do protocolo nativo antigo.
- Sugestões podem preencher a interface, mas não são votos enviados nem pontos definitivos.
- Divergências continuam pendentes. Palavra aprovada fica bloqueada. Líder pode reabrir; a nova época invalida votos antigos e limpa confirmações.
- Mostrar “Concluir revisão” e “Voltar à revisão”. Só há resultados quando todas as palavras e confirmações estiverem completas.
- Forçar categoria é ação exclusiva do líder; exige seu voto nas pendências. Não inventar nota quando faltar voto. Forçar não dispensa as confirmações coletivas finais.

### Amigos, bilhetes e Roda Dourada

- Badge vermelho de amigos usa `/friends/requests/count`; listar a caixa de entrada em `/friends/requests` e refazer contagem após mudança.
- Cache de amigos e estado deve ser separado por UID e limpo no logout. Listas usam `items` e `next_cursor`, ordenadas por ID; não assumir ordem cronológica.
- Bilhete: `/tickets/:id` usa **código da sala** como `id`; `/tickets/status` exige `?room_code=...`.
- Não mostrar anúncio como disponível neste backend. Oferecer alternativa gratuita verdadeira. Se não houver integração, mostrar indisponibilidade sem criar recompensa/premium local.
- Para futura compra nativa, obter `billing_identity` em `/me/entitlements`: Google usa `google_account_id` como `obfuscatedAccountId`; Apple usa `apple_account_token` como `appAccountToken`.
- Web reconhece compra nativa do mesmo UID. Checkout Web não foi implementado; não inventar botão de pagamento funcional.
- Guiar permissões pelo estado retornado: benefício de sala não torna os convidados compradores individuais.

## 3. Arquivos criados e alterados

Alterados:

- `index.js`: monta o módulo no servidor existente, exporta `app` para testes, mantém execução direta com `npm start`, usa UUID nativo e remove log de corpo de despesa.
- `config/firebase.js`: carregamento de ambiente e entrypoints `firebase/compat`, preservando projeto e API usados pela agenda.
- `package.json`, `package-lock.json`: Admin SDK, biblioteca oficial Apple, Prettier, versões atualizadas, Node 24 e Command Hub; separadores antigos preservados.
- `README.md`: documentação de setup, serviços antigos, novo módulo, configuração, segurança, testes, URLs e Heroku.

Criados:

- `adedonha/firebase.js`, `rules.js`, `errors.js`, `middleware.js`, `controller.js`, `routes.js`, `service.js`, `stores.js`.
- `data/adedonhaRules.json`.
- `tests/adedonha.test.js`, `tests/integration.test.js`, `tests/helpers.js`, `tests/godot-contract-fixtures.json`.
- `scripts/commands.js`.
- `.env.example`.
- `firebase/firestore.rules`, `firebase/firestore.indexes.json`, `firebase/README.md`.
- `docs/ADEDONHA_FRONTEND_INTEGRATION.md` e este registro.

Não foram alterados: Godot, frontend, `Procfile`, controllers e rotas antigos de agenda/resumo, regras remotas ou infraestrutura de produção. Não houve deploy.

## 4. Verificações executadas

- `npm install` executado; dependências e lockfile atualizados.
- `npm test`: **32 testes aprovados, 0 falhas e 0 ignorados**, usando repositório transacional em memória e mocks explícitos para identidade, anúncios e lojas. Detalhes em `docs/ADEDONHA_VALIDATION.md`.
- `npm run format`, `npm run lint` e `npm run build` executados.
- `npm start` executado; servidor iniciou em `http://localhost:3002`.
- Consultas HTTP reais nesse servidor: `/health`, `/rules`, `/categories?locale=pt`, `/letters?locale=pt` retornaram **200**. Health informou corretamente `firebase: "unavailable"`.
- Testes antigos cobrem CRUD real em memória de despesas e validação das rotas de agenda/resumo; não houve acesso real ao banco da agenda nem ao GitHub.
- Auditoria npm foi executada, atualizações compatíveis aplicadas, Firebase atualizado com camada compat e dependência UUID substituída pelo Node nativo. **Ainda restam 10 avisos transitivos: 4 high e 6 moderate, sem critical**, na última auditoria. Não afirmar que a auditoria está limpa; investigar sem forçar downgrade ou override sem validar os serviços antigos.

## 5. Pendências reais que o próximo prompt não deve esconder

1. **Credenciais Adedonha não configuradas**: `ADEDONHA_FIREBASE_PROJECT_ID=adedonha-stop`, `ADEDONHA_FIREBASE_CLIENT_EMAIL`, `ADEDONHA_FIREBASE_PRIVATE_KEY`. O módulo público funciona; as operações persistentes precisam dessa configuração.
2. **Compatibilidade com Godot exige migração do cliente**. O aplicativo inspecionado ainda grava diretamente no Firestore e permite licença sandbox. Compartilhar o projeto Firebase não basta para afirmar que o app antigo já joga nas salas da API. A API rejeita salas antigas com `ROOM_MIGRATION_REQUIRED`; é necessário migrar escritas nativas e coordenar as regras. O Godot não foi modificado por instrução do pedido.
3. Regras/índices preparados, **não publicados e não testados no emulador**. Validar acesso de estranhos, rascunhos privados, permissões, login nativo e concorrência em Firebase real antes de produção.
4. Configurar credenciais/produtos reais Google Play e App Store; instalar/conectar billing nativo e executar compras, restaurações, reembolsos e revogações reais. Os adaptadores existem, mas a suíte usa mocks; **não foram homologados nas lojas**.
5. Nenhum provedor de anúncios configurado/validado. Não existe callback SSV habilitado. Há interface de integração e alternativa gratuita real; aprovação por declaração do cliente não existe.
6. A página e o checkout Web ainda não existem nesta entrega. Implementar o frontend em sua pasta própria com base no contrato.
7. Limite de IP em memória é por processo; mutações têm limite por UID transacional entre dynos. Preparar limitação no ingresso para tráfego alto; não confiar indiscriminadamente em cabeçalhos proxy.
8. Resolver os avisos transitivos npm restantes com validação de compatibilidade. Serviços externos e deploy continuam pendentes.

## 6. Texto que pode ser levado ao GPT

> Aprimore o prompt para implementar o frontend Adedonha/STOP no projeto existente, com rotas equivalentes `/adedonha` e `/stop`. Use o registro factual `docs/ADEDONHA_BACKEND_HANDOFF_PT.md` e, como autoridade técnica, `docs/ADEDONHA_FRONTEND_INTEGRATION.md` do backend. Não invente endpoints, campos, listas, serviços configurados ou integrações homologadas. Inclua consumo das 49 rotas, login Google/Firebase, envelope data/error, idempotência, controle de versão e IDs, listener Firestore com operações por REST, polling de timer/STOP, revisão por unanimidade e épocas, badge de amigos, bilhetes gratuitos e reconhecimento de premium pelo UID. Separe UI funcional local das integrações externas ainda não configuradas. Registre que o Godot antigo precisa migrar suas gravações para a API antes do multiplayer seguro entre plataformas; não declare interoperabilidade já concluída. Leia os arquivos reais do frontend antes de alterar e preserve suas funcionalidades existentes. Exija testes e verificação visual da implementação, sem deploy automático.
