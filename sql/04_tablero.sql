-- =====================================================================
-- 04_tablero.sql — Tablas planas para el dashboard (Looker Studio)
-- =====================================================================
-- Looker Studio no relaciona tablas como un modelo estrella, así que
-- desde el DW armamos 3 tablas "listas para graficar" y las exportamos
-- a dw/ como CSV. No forman parte del modelo estrella: se leen de él.
-- Las columnas que comparten (fecha, canal) tienen el mismo nombre en
-- las tres para que los filtros del tablero apliquen a todas.
-- =====================================================================


-- ---------------------------------------------------------------------
-- TABLERO_VENTAS: una fila por producto vendido, solo pedidos PAID o
-- FULFILLED. "ventas" reparte el total del pedido (con IVA y envío)
-- entre sus productos en proporción a cada línea, así la suma da el
-- total de ventas y el filtro de producto aplica a todos los KPIs.
-- ---------------------------------------------------------------------
COPY (
    SELECT
        i.order_item_id,
        i.order_id,
        d.fecha,
        ch.name AS canal,
        pr.name AS provincia,
        COALESCE(st.name, 'Online') AS tienda,
        p.name AS producto,
        i.quantity AS cantidad,
        i.line_total AS ventas_linea,
        ROUND(CAST(i.line_total AS DOUBLE) * o.total_amount / o.subtotal, 2) AS ventas
    FROM fact_sales_order_item AS i
    JOIN fact_sales_order AS o
        ON o.order_id = i.order_id
    JOIN dim_date AS d
        ON d.date_key = i.date_key
    JOIN dim_channel AS ch
        ON ch.channel_key = i.channel_key
    JOIN dim_product AS p
        ON p.product_key = i.product_key
    LEFT JOIN dim_province AS pr
        ON pr.province_key = o.province_key
    LEFT JOIN dim_store AS st
        ON st.store_key = i.store_key
    WHERE o.status IN ('PAID', 'FULFILLED')
    ORDER BY i.order_item_id
) TO 'dw/tablero_ventas.csv' (HEADER);


-- ---------------------------------------------------------------------
-- TABLERO_SESIONES: una fila por sesión web (todas son canal online).
-- "usuario" identifica al cliente si inició sesión; si es anónimo,
-- se usa la sesión (como indica la consigna).
-- ---------------------------------------------------------------------
COPY (
    SELECT
        w.session_id,
        strftime(d.fecha, '%Y%m%d') AS fecha,
        ch.name AS canal,
        CASE
            WHEN c.customer_id IS NOT NULL THEN 'C-' || c.customer_id
            ELSE 'S-' || w.session_id
        END AS usuario,
        CASE
            WHEN c.customer_id IS NOT NULL THEN 'Identificado'
            ELSE 'Anónimo'
        END AS tipo_usuario,
        w.source AS origen,
        w.device AS dispositivo
    FROM fact_web_session AS w
    JOIN dim_date AS d
        ON d.date_key = w.date_key
    LEFT JOIN dim_customer AS c
        ON c.customer_key = w.customer_key
    CROSS JOIN dim_channel AS ch
    WHERE ch.code = 'ONLINE'
    ORDER BY w.session_id
) TO 'dw/tablero_sesiones.csv' (HEADER);


-- ---------------------------------------------------------------------
-- TABLERO_NPS: una fila por respuesta. NPS = % promotores - % detractores
-- ---------------------------------------------------------------------
COPY (
    SELECT
        n.nps_id,
        d.fecha,
        ch.name AS canal,
        n.score AS puntaje,
        CASE
            WHEN n.score >= 9 THEN 'Promotor'
            WHEN n.score >= 7 THEN 'Pasivo'
            ELSE 'Detractor'
        END AS categoria,
        CASE WHEN n.score >= 9 THEN 1 ELSE 0 END AS promotor,
        CASE WHEN n.score <= 6 THEN 1 ELSE 0 END AS detractor
    FROM fact_nps AS n
    JOIN dim_date AS d
        ON d.date_key = n.date_key
    JOIN dim_channel AS ch
        ON ch.channel_key = n.channel_key
    ORDER BY n.nps_id
) TO 'dw/tablero_nps.csv' (HEADER);


-- ---------------------------------------------------------------------
-- TABLERO_PAGOS: una fila por pago (todos los estados).
-- metodo: GATEWAY = Mercado Pago (pasarela de pago online).
-- "fallido" vale 1 si el pago fue rechazado, para calcular la tasa.
-- La fecha es la del pedido, igual que en el resto del tablero.
-- ---------------------------------------------------------------------
COPY (
    SELECT
        p.payment_id,
        p.order_id,
        d.fecha,
        ch.name AS canal,
        pr.name AS provincia,
        CASE p.method
            WHEN 'CARD'     THEN 'Tarjeta'
            WHEN 'GATEWAY'  THEN 'Mercado Pago'
            WHEN 'CASH'     THEN 'Efectivo'
            WHEN 'TRANSFER' THEN 'Transferencia'
            ELSE p.method
        END AS metodo,
        CASE p.status
            WHEN 'PAID'     THEN 'Pagado'
            WHEN 'FAILED'   THEN 'Fallido'
            WHEN 'REFUNDED' THEN 'Reembolsado'
            WHEN 'PENDING'  THEN 'Pendiente'
            ELSE p.status
        END AS estado,
        p.amount AS monto,
        CASE WHEN p.status = 'FAILED' THEN 1 ELSE 0 END AS fallido
    FROM fact_payment AS p
    JOIN dim_date AS d
        ON d.date_key = p.date_key
    JOIN dim_channel AS ch
        ON ch.channel_key = p.channel_key
    JOIN fact_sales_order AS o
        ON o.order_id = p.order_id
    LEFT JOIN dim_province AS pr
        ON pr.province_key = o.province_key
    ORDER BY p.payment_id
) TO 'dw/tablero_pagos.csv' (HEADER);


-- ---------------------------------------------------------------------
-- TABLERO_ENVIOS: una fila por envío de Correo Argentino.
-- dias_entrega = días entre el pedido y la entrega (vacío si no se
-- entregó). "entregado" vale 1 si el envío llegó a destino.
-- ---------------------------------------------------------------------
COPY (
    SELECT
        s.shipment_id,
        s.order_id,
        d.fecha,
        ch.name AS canal,
        pr.name AS provincia,
        COALESCE(st.name, 'Online') AS tienda,
        CASE s.status
            WHEN 'DELIVERED' THEN 'Entregado'
            WHEN 'SHIPPED'   THEN 'En camino'
            WHEN 'READY'     THEN 'Listo para despachar'
            WHEN 'CANCELLED' THEN 'Cancelado'
            ELSE s.status
        END AS estado,
        s.delivery_days AS dias_entrega,
        CASE WHEN s.status = 'DELIVERED' THEN 1 ELSE 0 END AS entregado
    FROM fact_shipment AS s
    JOIN dim_date AS d
        ON d.date_key = s.date_key
    JOIN dim_channel AS ch
        ON ch.channel_key = s.channel_key
    LEFT JOIN dim_province AS pr
        ON pr.province_key = s.province_key
    LEFT JOIN dim_store AS st
        ON st.store_key = s.store_key
    ORDER BY s.shipment_id
) TO 'dw/tablero_envios.csv' (HEADER);
