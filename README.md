# Shop.co

Loja de moda construída com React, Vite e uma API Express.

## Funcionalidades

- Catálogo pesquisável, páginas de produto e carrinho com controlo de stock
- Registo de clientes e vendedores, início de sessão e gestão de produtos
- Upload de foto de perfil para contas de cliente, vendedor e administrador
- Produtos de vendedor sujeitos a aprovação do administrador
- Dashboard administrativa com indicadores de vendas, fornecedores, inventário, expedição, devoluções e repasses
- Chat entre clientes e vendedores por produto
- Custo de intermediação de 2% cobrado junto com os produtos
- Comentários públicos sobre a experiência de compra, disponíveis para clientes com encomenda paga
- Pagamento ProxyPay RPS em AOA por referência Multicaixa
- Encomendas confirmadas pela API após validação da assinatura e do valor do webhook ProxyPay
- Histórico de encomendas do cliente com estados de expedição, devolução e rastreio
- Preços e pagamentos em KZ; produtos antigos cotados em EUR são convertidos pela cotação EUR/AOA

## Requisitos e desenvolvimento local

Requer Node.js 22.12 ou superior, npm e PostgreSQL 14 ou superior.

```sh
npm ci
cp .env.example .env
npm run dev
```

Crie uma base PostgreSQL local e configure `DATABASE_URL` no `.env` antes de iniciar. O schema e os produtos de demonstração são criados automaticamente na primeira execução. Em desenvolvimento, os uploads de imagens de produtos e fotos de perfil funcionam sem S3 e são guardados em `server/uploads/`; para produção, configure um bucket S3 compatível. Utilizadores autenticados podem escolher ou substituir a foto na página da conta, em «Entrar». As fotos de perfil usam o nome normalizado da conta, o ID do utilizador e um identificador por upload para evitar colisões e cache desatualizada; os nomes de produtos são aleatórios.

Vendedores devem guardar um ponto de recolha no painel. No checkout, o comprador pode autorizar o navegador a usar a localização atual uma vez ou pesquisar a morada/bairro/município como alternativa, caso o dispositivo não consiga obter GPS. A página tem de estar aberta em HTTPS (ou localhost durante o desenvolvimento), e a permissão de localização tem de estar autorizada no navegador e no dispositivo. A pesquisa e o cálculo das distâncias rodoviárias usam Google Maps Platform (Geocoding API e Routes API), configurado através de `GOOGLE_MAPS_API_KEY` no servidor (nunca numa variável `VITE_*`). No Google Cloud, ativa a faturação e ambas as APIs, cria uma chave de servidor e restringe-a à Geocoding API e à Routes API; restringe também por IP de saída do servidor sempre que possível. Define quotas e alertas de orçamento: os pedidos podem gerar custos Google Cloud. As moradas e coordenadas são enviadas ao Google Maps para processar a pesquisa e a rota; a loja não as guarda permanentemente. A tarifa aplica 500 AOA de base + 100 AOA por quilómetro para cada vendedor distinto; produtos da loja sem vendedor têm apenas a taxa base de 500 AOA. O comprador paga o total em AOA através de uma referência ProxyPay RPS.

Frontend: <http://localhost:5173>
API: <http://localhost:4000/api/health>

O proxy local mantém o prefixo `/api` ao encaminhar pedidos para o Express.
Em desenvolvimento, as contas de demonstração são criadas quando não existem utilizadores:

- Administrador: `admin@shopco.com` / `admin123`
- Cliente: `cliente@shopco.com` / `cliente123`

Estas contas só são criadas fora de produção. Não reutilize estas credenciais num ambiente real.

## Testes e verificações

```sh
npm test
npm run lint
npm run build
```

## ProxyPay RPS

Configure no `.env` `PROXYPAY_API_KEY`, `PROXYPAY_ENTITY_ID` e `PROXYPAY_WEBHOOK_URL`. O webhook deve ser uma URL pública HTTPS que aponte para `POST /api/webhooks/proxypay`. Em desenvolvimento, `PROXYPAY_API_URL` usa por padrão `https://api.sandbox.proxypay.co.ao`; configure a chave e entidade de sandbox. Em produção, configure explicitamente `PROXYPAY_API_URL=https://api.proxypay.co.ao` e os dados de produção. A API recusa iniciar em produção se o endpoint ou webhook não forem HTTPS, se a entidade não for numérica ou se o caminho do webhook estiver incorreto.

O checkout apresenta a entidade, referência, valor exato e validade ao cliente. A referência reserva o stock durante o pagamento; encomendas só são confirmadas após validação HMAC do corpo original do webhook, entidade, referência e montante. O processamento do webhook é idempotente. Configure no painel ProxyPay o webhook com o evento de pagamento correspondente ao RPS. A aplicação nunca simula um pagamento concluído.

Os reembolsos ProxyPay não são executados pela aplicação: processa primeiro o reembolso integral no canal do comerciante e regista depois, no painel, a referência do comprovativo. Esse registo atualiza a encomenda e ajusta os repasses pendentes. Stripe mantém-se apenas para confirmar ou reembolsar encomendas legadas já existentes. Configure `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` apenas se ainda precisar dessa compatibilidade.

## Moeda e comentários

Produtos cotados em EUR são convertidos para AOA usando a cotação pública EUR/AOA de `open.er-api.com`, atualizada na API no máximo a cada seis horas. A mesma taxa é usada para calcular a referência, e o pagamento efetivo é sempre apresentado em AOA. Se o serviço estiver indisponível, a loja pode apresentar a referência de fallback, mas o checkout e a cotação de envio ficam indisponíveis até existir uma taxa atual. Os relatórios internos existentes continuam a usar valores equivalentes em EUR; o histórico do cliente apresenta o valor e a discriminação efetivamente pagos em AOA.

Clientes autenticados com pelo menos uma encomenda paga podem publicar um comentário sobre a experiência de compra. Cada cliente pode publicar um comentário, que fica visível imediatamente e mostra apenas o primeiro nome.

## Vendedores, mensagens e comissão

No registo, o utilizador escolhe entre cliente e vendedor. Os clientes podem indicar categorias, estilos, cores e orçamento preferidos; estas respostas ficam guardadas no perfil e ordenam as sugestões do catálogo após a autenticação. Vendedores publicam produtos com preço base em KZ; cada produto aguarda aprovação do administrador, e uma edição volta a colocá-lo na fila de aprovação. Clientes com sessão iniciada podem abrir uma conversa sobre qualquer produto publicado. As mensagens são guardadas na base de dados e atualizadas no chat a cada três segundos.

O painel de administração reúne vendas por período (7, 30 ou 90 dias), pagamentos, comissão, portes, clientes, fornecedores, catálogo, inventário baixo/esgotado, aprovações e checkouts por confirmar. Inclui desempenho por fornecedor, produtos vendidos e o fluxo operacional das encomendas. A equipa pode registar preparação, transportadora e código de envio, acompanhar devoluções e o respetivo rastreio inverso, solicitar reembolsos Stripe de encomendas legadas e repor no inventário artigos devolvidos. Para pagamentos ProxyPay, o reembolso é manual no canal do comerciante.

Os repasses devidos aos vendedores são apurados por encomenda, incluindo as encomendas existentes quando o novo schema é aplicado. A dashboard permite registar a liquidação ou recuperação com a referência do comprovativo, mas não executa transferências bancárias. Um reembolso Stripe integral atualiza a encomenda e cancela repasses pendentes ou sinaliza a recuperação de repasses já liquidados. Os estados de transporte são registos manuais e não são sincronizados com transportadoras. O checkout calcula uma comissão de intermediação de 2% sobre o preço base, mostra-a discriminada e inclui-a no valor cobrado. Os 2% representam a comissão da plataforma e não substituem taxas ProxyPay, impostos ou obrigações legais.

Clientes autenticados podem consultar as suas encomendas em «As minhas encomendas». A API limita a consulta às encomendas do próprio cliente e devolve no máximo as 100 mais recentes.

## Segurança da API

A API envia cabeçalhos de segurança com Helmet e limita pedidos a 600 por IP em 15 minutos; registo e início de sessão partilham um limite mais estrito de 10 pedidos por IP no mesmo período. Estes limites são mantidos em memória por processo: numa instalação com várias réplicas, configure um armazenamento de limites partilhado antes de aumentar horizontalmente. Se a API estiver atrás de um proxy, configure `TRUST_PROXY` com os saltos ou redes de proxy realmente confiáveis; não use um valor genérico sem validar a topologia.

## Publicação

O workflow de GitHub Actions executa lint, testes e build em pull requests; apenas publica o `dist/` no GitHub Pages em `main` ou por execução manual. Configure a variável de repositório `VITE_API_URL` com o endereço público completo da API, incluindo `/api` (por exemplo, `https://api.exemplo.pt/api`). O workflow falha deliberadamente se essa variável estiver ausente.

A API tem de ser hospedada separadamente. No serviço da API configure:

- `NODE_ENV=production`
- `TRUST_PROXY` com os saltos ou redes confiáveis, se a API estiver atrás de um proxy
- `DATABASE_URL` para uma instância PostgreSQL gerida
- `DATABASE_SSL=true`; se o fornecedor usar uma autoridade certificadora privada, configure-a em `DATABASE_SSL_CA`
- `JWT_SECRET` com pelo menos 32 caracteres aleatórios
- `PROXYPAY_API_KEY`, `PROXYPAY_ENTITY_ID`, `PROXYPAY_API_URL` e `PROXYPAY_WEBHOOK_URL`
- `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` apenas para encomendas Stripe legadas
- `GOOGLE_MAPS_API_KEY` com Geocoding API e Routes API ativadas e faturação configurada
- `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` e `S3_PUBLIC_BASE_URL`; configure `S3_ENDPOINT` para serviços S3 compatíveis que não sejam AWS
- `FRONTEND_URL` com a URL publicada do frontend, incluindo o caminho do repositório quando aplicável
- `CORS_ORIGINS` com a origem do frontend (apenas esquema e domínio, sem caminho)
- `ADMIN_EMAIL` e `ADMIN_PASSWORD` (mínimo 12 caracteres) na primeira inicialização para criar o administrador inicial

Em produção, a API recusa iniciar sem os serviços e segredos essenciais e desativa as contas de demonstração caso existam.

## Migração de dados locais

O catálogo, utilizadores, reservas de checkout e encomendas ficam em PostgreSQL; as imagens carregadas são guardadas no bucket S3. O bucket ou CDN deve permitir leitura pública dos objetos, pois o catálogo serve URLs públicas de imagem. Para importar o antigo `server/data/db.json`, faça primeiro uma cópia de segurança, configure `DATABASE_URL` e execute:

```sh
npm run migrate:postgres
```

Execute a migração antes de iniciar a API pela primeira vez na nova base de dados, para evitar que os dados de demonstração sejam criados antes da importação. O script é idempotente para registos com os mesmos IDs, preserva o JSON original e também aceita um caminho alternativo (`npm run migrate:postgres -- /caminho/para/db.json`). Reveja o resumo de registos importados e valide os dados antes de remover a cópia de segurança. A migração não transfere os ficheiros de imagem locais para S3; imagens existentes devem continuar acessíveis no seu URL atual ou ser carregadas novamente.

Configure backups e recuperação tanto para PostgreSQL como para o bucket. GitHub Pages publica apenas o frontend; não hospeda a API.

## Estrutura

- `src/`: frontend React ativo
- `server/`: API Express, schema PostgreSQL e catálogo de demonstração
- `image/`: imagens servidas como assets públicos do Vite

`script.js` e `style.css` são ficheiros legados; o frontend atual usa `src/App.jsx` e `src/index.css`.
