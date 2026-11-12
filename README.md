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
- Checkout Stripe alojado pelo Stripe; os dados do cartão não passam pela aplicação
- Encomendas confirmadas pela API após validação do pagamento Stripe
- Preços indicativos em KZ calculados a partir da cotação EUR/AOA

## Requisitos e desenvolvimento local

Requer Node.js 22, npm e PostgreSQL 14 ou superior.

```sh
npm ci
cp .env.example .env
npm run dev
```

Crie uma base PostgreSQL local e configure `DATABASE_URL` no `.env` antes de iniciar. O schema e os produtos de demonstração são criados automaticamente na primeira execução. Em desenvolvimento, os uploads de imagens de produtos e fotos de perfil funcionam sem S3 e são guardados em `server/uploads/`; para produção, configure um bucket S3 compatível. Utilizadores autenticados podem escolher ou substituir a foto na página da conta, em «Entrar». As fotos de perfil usam o nome normalizado da conta, o ID do utilizador e um identificador por upload para evitar colisões e cache desatualizada; os nomes de produtos são aleatórios.

Vendedores devem guardar um ponto de recolha no painel. No checkout, o comprador pode autorizar o navegador a usar a localização atual uma vez. A API calcula a distância rodoviária com OpenRouteService e aplica 500 AOA de base + 100 AOA por quilómetro para cada vendedor distinto; produtos da loja sem vendedor têm apenas a taxa base de 500 AOA. As coordenadas do comprador não são guardadas pela loja, mas são enviadas ao OpenRouteService para calcular o percurso. Configure `OPENROUTESERVICE_API_KEY` no `.env`; sem essa chave, a cotação de envio não fica disponível. O valor calculado em AOA é convertido em EUR para o pagamento Stripe.

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

## Stripe

Configure no `.env` uma chave Stripe em `STRIPE_SECRET_KEY` e o segredo do webhook em `STRIPE_WEBHOOK_SECRET`. O webhook deve apontar para `POST /api/webhooks/stripe` e encaminhar os eventos `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired` e `refund.updated`. Use Stripe CLI para desenvolvimento local.

Sem Stripe configurado, o checkout falha explicitamente; a aplicação nunca simula um pagamento concluído. A confirmação no regresso do checkout e o webhook usam a mesma operação idempotente para gravar a encomenda e atualizar o stock.

## Moeda e comentários

Os preços e encomendas continuam cobrados pelo Stripe em EUR. A loja apresenta valores em KZ usando a cotação pública EUR/AOA de `open.er-api.com`, atualizada na API no máximo a cada seis horas. Se o serviço estiver indisponível, a API usa a referência de 1 EUR = 1059,809072 AOA, obtida em 10/11/2026, e mostra um aviso de que pode estar desatualizada. Essa referência serve apenas para exibição: o checkout de produtos com preço em KZ fica indisponível até existir uma cotação atual. O checkout informa o total efetivamente cobrado em EUR; os valores em KZ são indicativos e podem variar com a taxa.

Clientes autenticados com pelo menos uma encomenda paga podem publicar um comentário sobre a experiência de compra. Cada cliente pode publicar um comentário, que fica visível imediatamente e mostra apenas o primeiro nome.

## Vendedores, mensagens e comissão

No registo, o utilizador escolhe entre cliente e vendedor. Os clientes podem indicar categorias, estilos, cores e orçamento preferidos; estas respostas ficam guardadas no perfil e ordenam as sugestões do catálogo após a autenticação. Vendedores publicam produtos com preço base em KZ; cada produto aguarda aprovação do administrador, e uma edição volta a colocá-lo na fila de aprovação. Clientes com sessão iniciada podem abrir uma conversa sobre qualquer produto publicado. As mensagens são guardadas na base de dados e atualizadas no chat a cada três segundos.

O painel de administração reúne vendas por período (7, 30 ou 90 dias), pagamentos, comissão, portes, clientes, fornecedores, catálogo, inventário baixo/esgotado, aprovações e checkouts por confirmar. Inclui desempenho por fornecedor, produtos vendidos e o fluxo operacional das encomendas. A equipa pode registar preparação, transportadora e código de envio, acompanhar devoluções e o respetivo rastreio inverso, solicitar reembolsos ao Stripe e repor no inventário artigos devolvidos.

Os repasses devidos aos vendedores são apurados por encomenda, incluindo as encomendas existentes quando o novo schema é aplicado. A dashboard permite registar a liquidação ou recuperação com a referência do comprovativo, mas não executa transferências bancárias. Um reembolso Stripe integral atualiza a encomenda e cancela repasses pendentes ou sinaliza a recuperação de repasses já liquidados. Os estados de transporte são registos manuais e não são sincronizados com transportadoras. O checkout calcula uma comissão de intermediação de 2% sobre o preço base, mostra-a discriminada e inclui-a no valor cobrado. Preços em KZ são convertidos para EUR à cotação disponível no servidor antes de criar a sessão Stripe. Os 2% representam a comissão da plataforma e não substituem taxas Stripe, impostos ou obrigações legais.

## Publicação

O workflow de GitHub Actions compila o frontend com Vite e publica o `dist/` no GitHub Pages. Configure a variável de repositório `VITE_API_URL` com o endereço público completo da API, incluindo `/api` (por exemplo, `https://api.exemplo.pt/api`). O workflow falha deliberadamente se essa variável estiver ausente.

A API tem de ser hospedada separadamente. No serviço da API configure:

- `NODE_ENV=production`
- `DATABASE_URL` para uma instância PostgreSQL gerida
- `DATABASE_SSL=true`; se o fornecedor usar uma autoridade certificadora privada, configure-a em `DATABASE_SSL_CA`
- `JWT_SECRET` com pelo menos 32 caracteres aleatórios
- `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET`
- `OPENROUTESERVICE_API_KEY` para calcular distâncias rodoviárias e custos de envio
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
