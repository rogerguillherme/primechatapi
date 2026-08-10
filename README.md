# Disparo API

Você é um arquiteto de software sênior especializado em sistemas SaaS, CRM e integrações via webhook.

Quero que você projete e ajude a implementar um sistema de CRM de pedidos para a marca “Menopausa Cancelada”, com foco em organização de compradores, pedidos e kits físicos.

CONTEXTO GERAL
- Os pedidos chegam via Webhook da plataforma Hubla.
- Cada webhook representa uma compra.
- Um mesmo comprador pode realizar várias compras.
- A identificação única do comprador deve ser feita pelo NÚMERO DE TELEFONE (normalizado).
- O sistema deve criar ou reutilizar automaticamente o cadastro do comprador.

REGRA DE IDENTIFICAÇÃO DO LEAD
- Sempre que um webhook chegar:
  1. Normalizar o telefone (somente números, incluindo DDI).
  2. Buscar se já existe um lead com esse telefone.
  3. Se existir, associar o pedido ao lead existente.
  4. Se não existir, criar um novo lead e associar o pedido.

MODELO DE PRODUTO (MUITO IMPORTANTE)
- O nome do produto vindo do webhook NÃO deve ser interpretado por texto ou regras condicionais.
- Cada produto do checkout deve ser tratado como um “PACOTE” (SKU lógico).
- Cada pacote possui uma composição fixa de itens físicos (kits ou suplementos).

EXEMPLOS DE PRODUTOS (PACOTES):
- Menopausa Cancelada (Base)
- Menopausa Cancelada +1 Kit
- Menopausa Cancelada +2 Kits
- Menopausa Cancelada + Suplementação Completa

ITENS FÍSICOS:
- Kit Menopausa Cancelada
- Suplementos (ex: Ômega 3, Multivitamínico, etc.)

REQUISITOS DE MODELAGEM
Crie as seguintes entidades:
1. Leads (compradores)
   - nome
   - email
   - telefone (único e normalizado)
   - origem
   - datas de criação e atualização

2. Products (pacotes/SKUs do checkout)
   - nome_exato_do_checkout
   - sku
   - ativo

3. Items (itens físicos)
   - nome
   - tipo (kit ou suplemento)

4. Product_Items (mapa de composição)
   - product_id
   - item_id
   - quantidade

5. Orders (pedidos)
   - lead_id
   - product_id
   - order_id_externo (Hubla – único)
   - valor
   - status
   - forma de pagamento
   - datas

6. Order_Items (itens gerados automaticamente)
   - order_id
   - item_id
   - quantidade

FLUXO DO WEBHOOK
1. Receber webhook da Hubla.
2. Validar idempotência (não criar pedidos duplicados).
3. Resolver o produto pelo nome do checkout.
4. Criar o pedido.
5. Gerar automaticamente os itens do pedido com base na composição do produto.
6. Salvar o payload original para auditoria.

REGRAS IMPORTANTES
- Nunca parsear texto do nome do produto (+1, +2, etc).
- Toda a lógica de kits deve estar no cadastro do produto.
- O sistema deve suportar novos produtos sem alteração de código.
- Webhooks de atualização (reembolso, chargeback) devem atualizar o pedido existente.

EXTRAS DESEJÁVEIS
- Estrutura pronta para controle de estoque no futuro.
- Facilidade de integração com WhatsApp e logística.
- Código limpo, escalável e documentado.

ENTREGAS ESPERADAS
- Modelagem de banco de dados (SQL ou ORM).
- Fluxo lógico do webhook.
- Estrutura de API ou automação.
- Sugestão de stack ideal para SaaS.

Construa a solução pensando em crescimento, clareza e manutenção de longo prazo.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://primechatapi.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/71b33132-6458-472c-8ab1-a15410cbaff0).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
