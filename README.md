# Shop.co

Loja de moda construída com React, Vite e uma API Express.

## Funcionalidades

- Catálogo pesquisável, páginas de produto e carrinho com controlo de stock
- Registo, início de sessão e gestão de produtos para administradores
- Checkout Stripe alojado pelo Stripe; os dados do cartão não passam pela aplicação
- Encomendas confirmadas pela API após validação do pagamento Stripe

## Requisitos e desenvolvimento local

Requer Node.js 22, npm e PostgreSQL 14 ou superior.

```sh
npm ci
cp .env.example .env
npm run dev
```

Crie uma base PostgreSQL local e configure `DATABASE_URL` no `.env` antes de iniciar. O schema e os produtos de demonstração são criados automaticamente na primeira execução. Para uploads de imagens, configure um bucket S3 compatível; sem essa configuração, o endpoint de upload devolve um erro explícito.

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

Configure no `.env` uma chave de teste Stripe em `STRIPE_SECRET_KEY` e o segredo do webhook em `STRIPE_WEBHOOK_SECRET`. O webhook deve apontar para `POST /api/webhooks/stripe` e encaminhar os eventos `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` e `checkout.session.expired`. Use Stripe CLI para desenvolvimento local.

Sem Stripe configurado, o checkout falha explicitamente; a aplicação nunca simula um pagamento concluído. A confirmação no regresso do checkout e o webhook usam a mesma operação idempotente para gravar a encomenda e atualizar o stock.

## Publicação

O workflow de GitHub Actions compila o frontend com Vite e publica o `dist/` no GitHub Pages. Configure a variável de repositório `VITE_API_URL` com o endereço público completo da API, incluindo `/api` (por exemplo, `https://api.exemplo.pt/api`). O workflow falha deliberadamente se essa variável estiver ausente.

A API tem de ser hospedada separadamente. No serviço da API configure:

- `NODE_ENV=production`
- `DATABASE_URL` para uma instância PostgreSQL gerida
- `DATABASE_SSL=true`; se o fornecedor usar uma autoridade certificadora privada, configure-a em `DATABASE_SSL_CA`
- `JWT_SECRET` com pelo menos 32 caracteres aleatórios
- `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET`
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
