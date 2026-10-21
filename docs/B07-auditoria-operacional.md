# B07 — Auditoria operacional

## Objetivo

Registrar, na mesma transação, alterações administrativas críticas de pedidos, estoque e configurações. A B07 complementa `order_status_history`, `order_cancellations` e `product_stock_movements`; não substitui esses históricos especializados.

## Modelo

`operational_audit_log` é append-only e contém `id`, `actor_id`, `action`, `entity_type`, `entity_id`, `context` e `created_at`. O banco gera identificador e horário. `actor_id` preserva o UUID autenticado responsável.

Eventos:

- `order.status_changed`: status anterior e novo.
- `order.cancelled`: status no cancelamento, motivo e indicação de restauração.
- `inventory.restocked`: saldo anterior, entrada, saldo resultante e `operation_id`.
- `inventory.minimum_changed`: mínimo anterior, novo e saldo corrente.
- `store_settings.updated`: somente nomes dos campos operacionais alterados.

Não são registrados senha, hash, JWT, tokens, cookies, headers, chaves, sessão, Turnstile, credenciais nem payloads completos. Leituras, `place_order` e `get_manager_report` não geram eventos.

## Segurança

- RLS habilitado na tabela.
- `PUBLIC`, `anon` e `authenticated` não possuem acesso direto à tabela.
- `write_operational_audit_event` é interna, `SECURITY DEFINER`, possui `search_path` fixo, allowlists e não pode ser executada pelos papéis da aplicação.
- `get_operational_audit` exige autenticação e `is_manager()`, limita cada página a 200 eventos e usa cursor decrescente por `id`.
- Apenas `authenticated` recebe `EXECUTE` da consulta; `anon` e `PUBLIC` permanecem bloqueados.
- Nenhum papel normal pode inserir, atualizar ou apagar logs diretamente.

## Atomicidade e idempotência

Cada evento é escrito pela própria RPC administrativa antes do commit. Falha na auditoria desfaz a operação principal; rollback da operação também desfaz o evento. Retornos idempotentes de transição, cancelamento e reposição não geram evento duplicado. Atualizações sem mudança efetiva de mínimo ou configurações também não afirmam alteração inexistente.

## Compatibilidade

- B02: transições, cancelamentos e autorizações preservados.
- B03: Realtime e alertas não são alterados.
- B04: baixa, restauração, locks, movimentos e prevenção de overselling são preservados.
- B05: horários, pausa, modalidades, pagamentos, frete, total e `place_order` não são alterados.
- B06: `get_manager_report` e critérios financeiros não são alterados.

## Limitações e homologação

Não há interface visual nesta Task. A consulta fica disponível pela RPC para investigação futura. Após aplicação autorizada, a homologação deve executar uma alteração real de cada domínio em dados próprios de teste, confirmar exatamente um evento, validar retornos idempotentes sem duplicação, testar perfis não autorizados e comprovar bloqueios de INSERT/UPDATE/DELETE direto.
