# Salas com convidados — Adedonha - STOP

O backend continua a exigir `Authorization: Bearer <Firebase ID token>` para operações autenticadas.
Aceita os provedores Firebase `anonymous` e `google.com`. Não aceita um nickname como prova de identidade.

1. Convidado: autenticação anónima Firebase automática, apelido obrigatório (2–24 caracteres), nome mostrado no jogo.
2. Google: email sempre obtido do ID token verificado, nunca de um campo enviado pelo navegador.
3. Criar e entrar em sala: código de 5 caracteres para entrar, sem fornecer versão da sala.
4. Os critérios existentes de vagas, tickets, permissões e estado da sala continuam a aplicar-se.
5. Regras Firestore: membros autenticados, incluindo anónimos, podem ler a sala e o próprio rascunho; visitantes externos não.

No Firebase Console, ativar Authentication → Sign-in method → **Anonymous** e **Google** no projeto `adedonha-stop`.
Publicar as regras `firebase/firestore.rules` somente após rever as alterações; mantê-las alinhadas com a migração Godot.
O backend usa Firebase Admin com credenciais próprias (não publicar chave privada).
