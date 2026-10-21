# B06 — Contrato financeiro dos relatórios

## Fonte de verdade

`public.get_manager_report(date, date)` é a única fonte financeira da tela de Relatórios. A função exige usuário autenticado e `public.is_manager()`, usa `SECURITY DEFINER` com `search_path = public, pg_temp` e somente `authenticated` recebe `EXECUTE`.

## Regras

- Venda realizada: `orders.status = 'entregue'` sem registro correspondente em `order_cancellations`.
- Reconhecimento temporal: primeiro evento `order_status_history.to_status = 'entregue'`; na ausência histórica desse evento, `orders.created_at`.
- Período: datas civis inclusivas interpretadas em `America/Fortaleza`, convertidas no servidor para `[início, dia posterior ao fim)`.
- Faturamento B05: `orders.total`.
- Histórico sem `orders.total`: soma comprovável de `order_items.unit_price * quantity`, sem inventar taxa de entrega.
- Receita de entrega: somente `delivery_fee` conhecida em snapshot B05.
- Custo: exclusivamente `order_items.unit_cost * quantity`. Valores ausentes não usam `products.cost` e são informados em `coverage`.
- Despesas: `expenses.amount`, com competência em `expenses.created_at` nesta fase.
- Resultado: faturamento menos custos conhecidos menos despesas.
- Ticket médio: faturamento dividido pelas vendas realizadas; zero quando não houver venda.

## Resposta JSON

- `period`: datas solicitadas, timezone e limites temporais efetivos.
- `criteria`: critérios financeiros aplicados.
- `summary`: faturamento, produtos, entrega, custos, despesas, resultado, quantidade e ticket médio.
- `orders`: somente vendas realizadas necessárias à tabela administrativa, sem endereço, telefone ou e-mail.
- `coverage`: uso de snapshots B05, fallbacks históricos, origem temporal e cobertura de `unit_cost`.

## Limitações conhecidas

- Um resultado com itens sem `unit_cost` representa apenas o custo conhecido; `coverage.items_without_unit_cost` torna essa degradação explícita.
- Pedidos legados sem evento de entrega usam a criação como aproximação temporal documentada.
- `renderFinanceiro()` permanece inacessível pela navegação e mantém fórmulas antigas; ele não foi expandido nem redesenhado na B06.
