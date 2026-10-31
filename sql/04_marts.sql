-- =====================================================================
-- 04_marts.sql — Data marts para la visualización web
-- =====================================================================
-- Leen SOLO del modelo estrella (dim_ y fact_), nunca de raw.
--
-- La web tiene filtros (período, canal y provincia), pero no calcula
-- nada. Para eso cada mart trae precalculadas TODAS las combinaciones
-- de filtros con GROUPING SETS y CUBE:
--
--   período   -> todo el período, cada año y cada mes
--   canal     -> cada canal y "Todos"
--   provincia -> cada provincia y "Todas"
--
-- La página solo busca la fila que corresponde a los filtros elegidos
-- y la muestra. Totales, porcentajes, promedios, rankings y el "nivel"
-- (0 a 1) con el que se llena cada botella vienen calculados de acá.
--
-- Criterios:
--   * Venta = pedido con estado PAID o FULFILLED.
--   * Ventas = total del pedido (con IVA y envío). Venta neta = sin IVA.
--   * NPS = % promotores (9-10) - % detractores (0-6).
-- =====================================================================


-- ---------------------------------------------------------------------
-- MART_VENTAS: ventas, pedidos, ticket, IVA y estados de venta.
-- Una fila por período x canal x provincia (incluidos los totales).
-- ---------------------------------------------------------------------
CREATE TABLE mart_ventas AS
WITH base AS (
    SELECT
        d.year AS anio,
        d.month AS mes,
        ch.name AS canal,
        p.name AS provincia,
        f.customer_key,
        f.total_amount,
        f.subtotal,
        f.tax_amount,
        f.shipping_fee,
        f.status IN ('PAID', 'FULFILLED') AS es_venta,
        f.status IN ('CANCELLED', 'REFUNDED') AS es_perdido,
        ch.code = 'ONLINE' AS es_online
    FROM fact_sales_order AS f
    JOIN dim_date AS d ON d.date_key = f.date_key
    JOIN dim_channel AS ch ON ch.channel_key = f.channel_key
    JOIN dim_province AS p ON p.province_key = f.province_key
),
cubo AS (
    SELECT
        CASE WHEN GROUPING(anio) = 1 THEN 'total' WHEN GROUPING(mes) = 1 THEN 'anio' ELSE 'mes' END AS periodo_tipo,
        CASE WHEN GROUPING(anio) = 1 THEN 'Todo'
             WHEN GROUPING(mes) = 1 THEN CAST(anio AS VARCHAR)
             ELSE printf('%04d-%02d', anio, mes) END AS periodo,
        anio,
        mes,
        CASE WHEN GROUPING(canal) = 1 THEN 'Todos' ELSE canal END AS canal,
        CASE WHEN GROUPING(provincia) = 1 THEN 'Todas' ELSE provincia END AS provincia,
        SUM(CASE WHEN es_venta THEN total_amount END) AS ventas,
        SUM(CASE WHEN es_venta THEN tax_amount END) AS iva,
        SUM(CASE WHEN es_venta THEN subtotal END) AS productos,
        SUM(CASE WHEN es_venta THEN shipping_fee END) AS envios,
        SUM(CASE WHEN es_venta AND es_online THEN total_amount ELSE 0 END) AS ventas_online,
        SUM(CASE WHEN es_venta AND NOT es_online THEN total_amount ELSE 0 END) AS ventas_tiendas,
        SUM(CASE WHEN es_venta THEN 1 ELSE 0 END) AS pedidos_venta,
        COUNT(*) AS pedidos_totales,
        SUM(CASE WHEN es_perdido THEN total_amount ELSE 0 END) AS monto_perdido,
        COUNT(DISTINCT CASE WHEN es_venta THEN customer_key END) AS clientes_compradores
    FROM base
    GROUP BY GROUPING SETS ((), (anio), (anio, mes)), CUBE (canal, provincia)
)
SELECT
    periodo_tipo,
    periodo,
    anio,
    mes,
    canal,
    provincia,
    ROUND(ventas, 2)                                                    AS ventas,
    ROUND(ventas - iva, 2)                                              AS venta_neta,
    ROUND(iva, 2)                                                       AS iva,
    ROUND(iva * 100.0 / ventas, 1)                                      AS iva_cada_100,
    ROUND(productos, 2)                                                 AS productos,
    ROUND(envios, 2)                                                    AS envios,
    -- De cada $100 vendidos: cuánto es producto, envío e IVA (enteros que suman 100)
    ROUND(envios * 100.0 / ventas)                                      AS envio_de_100,
    ROUND(iva * 100.0 / ventas)                                         AS iva_de_100,
    100 - ROUND(envios * 100.0 / ventas) - ROUND(iva * 100.0 / ventas)  AS productos_de_100,
    ROUND(ventas_online, 2)                                             AS ventas_online,
    ROUND(ventas_tiendas, 2)                                            AS ventas_tiendas,
    ROUND(ventas_online * 100.0 / ventas, 1)                            AS pct_online,
    pedidos_venta,
    ROUND(ventas / pedidos_venta, 2)                                    AS ticket_promedio,
    pedidos_totales,
    ROUND(pedidos_venta * 100.0 / pedidos_totales, 1)                   AS pct_pedidos_venta,
    ROUND(monto_perdido, 2)                                             AS monto_perdido,
    clientes_compradores,
    -- Peso de esta selección sobre todo lo vendido (llena la botella grande)
    ROUND(ventas / MAX(CASE WHEN periodo_tipo = 'total' AND canal = 'Todos' AND provincia = 'Todas'
                            THEN ventas END) OVER (), 4)                AS nivel_total,
    ROUND(ventas * 100.0 / MAX(CASE WHEN periodo_tipo = 'total' AND canal = 'Todos' AND provincia = 'Todas'
                                    THEN ventas END) OVER (), 1)        AS pct_del_total,
    ROUND(ventas_online / MAX(CASE WHEN periodo_tipo = 'total' AND canal = 'Todos' AND provincia = 'Todas'
                                   THEN ventas END) OVER (), 4)         AS nivel_total_online,
    -- Canales: peso dentro de su período y provincia, y nivel frente al canal que más vende
    CASE WHEN canal <> 'Todos' THEN ROUND(ventas * 100.0
        / MAX(CASE WHEN canal = 'Todos' THEN ventas END) OVER (PARTITION BY periodo, provincia), 1) END AS pct_canal,
    CASE WHEN canal <> 'Todos' THEN ROUND(ventas
        / MAX(CASE WHEN canal <> 'Todos' THEN ventas END) OVER (PARTITION BY periodo, provincia), 4) END AS nivel_canal,
    -- Provincias: peso dentro de su período y canal, nivel y ranking
    CASE WHEN provincia <> 'Todas' THEN ROUND(ventas * 100.0
        / MAX(CASE WHEN provincia = 'Todas' THEN ventas END) OVER (PARTITION BY periodo, canal), 1) END AS pct_provincia,
    CASE WHEN provincia <> 'Todas' THEN ROUND(ventas
        / MAX(CASE WHEN provincia <> 'Todas' THEN ventas END) OVER (PARTITION BY periodo, canal), 4) END AS nivel_provincia,
    CASE WHEN provincia <> 'Todas' THEN RANK() OVER (
        PARTITION BY periodo, canal, provincia = 'Todas' ORDER BY ventas DESC) END AS ranking_provincia,
    -- Meses: nivel de la botella frente al mejor mes de la misma selección
    CASE WHEN periodo_tipo = 'mes' THEN ROUND(ventas
        / MAX(ventas) OVER (PARTITION BY periodo_tipo, canal, provincia), 4) END AS nivel_mes,
    CASE WHEN periodo_tipo = 'mes' THEN ROUND(ventas_online
        / MAX(ventas) OVER (PARTITION BY periodo_tipo, canal, provincia), 4) END AS nivel_mes_online,
    CASE WHEN periodo_tipo = 'mes' THEN ROUND(AVG(ventas)
        OVER (PARTITION BY periodo_tipo, canal, provincia), 2) END AS promedio_mensual,
    CASE WHEN periodo_tipo = 'mes' THEN ROUND(AVG(ventas) OVER (PARTITION BY periodo_tipo, canal, provincia)
        / MAX(ventas) OVER (PARTITION BY periodo_tipo, canal, provincia), 4) END AS nivel_promedio,
    CASE WHEN periodo_tipo = 'mes' THEN ROUND((ventas
        / AVG(ventas) OVER (PARTITION BY periodo_tipo, canal, provincia) - 1) * 100, 1) END AS pct_vs_promedio,
    CASE WHEN periodo_tipo = 'mes'
          AND ventas = MAX(ventas) OVER (PARTITION BY periodo_tipo, canal, provincia) THEN 1 ELSE 0 END AS es_mejor_mes,
    -- Venta neta e IVA por mes: alto de la barra frente al mes más alto
    CASE WHEN periodo_tipo = 'mes' THEN ROUND((ventas - iva)
        / MAX(ventas) OVER (PARTITION BY periodo_tipo, canal, provincia), 4) END AS nivel_mes_neta,
    CASE WHEN periodo_tipo = 'mes' THEN ROUND(iva
        / MAX(ventas) OVER (PARTITION BY periodo_tipo, canal, provincia), 4) END AS nivel_mes_iva,
    CASE WHEN periodo_tipo = 'mes' THEN ROUND(productos
        / MAX(ventas) OVER (PARTITION BY periodo_tipo, canal, provincia), 4) END AS nivel_mes_productos,
    CASE WHEN periodo_tipo = 'mes' THEN ROUND(envios
        / MAX(ventas) OVER (PARTITION BY periodo_tipo, canal, provincia), 4) END AS nivel_mes_envios
FROM cubo
ORDER BY periodo_tipo, periodo, canal, provincia;


-- ---------------------------------------------------------------------
-- MART_PRODUCTOS: ventas por producto, con su ranking dentro de cada
-- período, canal y provincia. Las líneas se prorratean al total del
-- pedido para que la suma coincida con las ventas totales.
-- ---------------------------------------------------------------------
CREATE TABLE mart_productos AS
WITH base AS (
    SELECT
        d.year AS anio,
        d.month AS mes,
        ch.name AS canal,
        p.name AS provincia,
        pr.name AS producto,
        i.quantity,
        CAST(i.line_total AS DOUBLE) * o.total_amount / o.subtotal AS ventas
    FROM fact_sales_order_item AS i
    JOIN fact_sales_order AS o ON o.order_id = i.order_id
    JOIN dim_date AS d ON d.date_key = o.date_key
    JOIN dim_channel AS ch ON ch.channel_key = o.channel_key
    JOIN dim_province AS p ON p.province_key = o.province_key
    JOIN dim_product AS pr ON pr.product_key = i.product_key
    WHERE o.status IN ('PAID', 'FULFILLED')
),
cubo AS (
    SELECT
        CASE WHEN GROUPING(anio) = 1 THEN 'total' WHEN GROUPING(mes) = 1 THEN 'anio' ELSE 'mes' END AS periodo_tipo,
        CASE WHEN GROUPING(anio) = 1 THEN 'Todo'
             WHEN GROUPING(mes) = 1 THEN CAST(anio AS VARCHAR)
             ELSE printf('%04d-%02d', anio, mes) END AS periodo,
        anio,
        mes,
        CASE WHEN GROUPING(canal) = 1 THEN 'Todos' ELSE canal END AS canal,
        CASE WHEN GROUPING(provincia) = 1 THEN 'Todas' ELSE provincia END AS provincia,
        producto,
        SUM(quantity) AS unidades,
        SUM(ventas) AS ventas
    FROM base
    GROUP BY producto, GROUPING SETS ((), (anio), (anio, mes)), CUBE (canal, provincia)
)
SELECT
    periodo_tipo, periodo, anio, mes, canal, provincia, producto,
    unidades,
    ROUND(ventas, 2)                                                            AS ventas,
    RANK() OVER (PARTITION BY periodo, canal, provincia ORDER BY ventas DESC)   AS ranking,
    ROUND(ventas * 100.0 / SUM(ventas) OVER (PARTITION BY periodo, canal, provincia), 1) AS pct_del_periodo,
    -- alto de la barra frente al mayor valor mensual de la selección
    CASE WHEN periodo_tipo = 'mes' THEN ROUND(ventas
        / MAX(ventas) OVER (PARTITION BY periodo_tipo, canal, provincia), 4) END AS nivel_mes
FROM cubo
ORDER BY periodo_tipo, periodo, canal, provincia, ranking;


-- ---------------------------------------------------------------------
-- MART_ESTADOS: pedidos por estado, para cada período, canal y provincia.
-- ---------------------------------------------------------------------
CREATE TABLE mart_estados AS
WITH base AS (
    SELECT
        d.year AS anio,
        d.month AS mes,
        ch.name AS canal,
        p.name AS provincia,
        CASE f.status
            WHEN 'FULFILLED' THEN 'Entregado'
            WHEN 'PAID'      THEN 'Pagado'
            WHEN 'CANCELLED' THEN 'Cancelado'
            WHEN 'REFUNDED'  THEN 'Reembolsado'
            WHEN 'CREATED'   THEN 'Creado'
        END AS estado,
        f.status IN ('PAID', 'FULFILLED') AS es_venta,
        f.total_amount
    FROM fact_sales_order AS f
    JOIN dim_date AS d ON d.date_key = f.date_key
    JOIN dim_channel AS ch ON ch.channel_key = f.channel_key
    JOIN dim_province AS p ON p.province_key = f.province_key
),
cubo AS (
    SELECT
        CASE WHEN GROUPING(anio) = 1 THEN 'total' WHEN GROUPING(mes) = 1 THEN 'anio' ELSE 'mes' END AS periodo_tipo,
        CASE WHEN GROUPING(anio) = 1 THEN 'Todo'
             WHEN GROUPING(mes) = 1 THEN CAST(anio AS VARCHAR)
             ELSE printf('%04d-%02d', anio, mes) END AS periodo,
        CASE WHEN GROUPING(canal) = 1 THEN 'Todos' ELSE canal END AS canal,
        CASE WHEN GROUPING(provincia) = 1 THEN 'Todas' ELSE provincia END AS provincia,
        estado,
        BOOL_OR(es_venta) AS es_venta,
        COUNT(*) AS pedidos,
        SUM(total_amount) AS monto
    FROM base
    GROUP BY estado, GROUPING SETS ((), (anio), (anio, mes)), CUBE (canal, provincia)
)
SELECT
    periodo_tipo, periodo, canal, provincia, estado,
    CASE WHEN es_venta THEN 1 ELSE 0 END                                         AS es_venta,
    CASE estado WHEN 'Entregado' THEN 1 WHEN 'Pagado' THEN 2 WHEN 'Cancelado' THEN 3
                WHEN 'Reembolsado' THEN 4 ELSE 5 END                             AS orden,
    pedidos,
    ROUND(pedidos * 100.0 / SUM(pedidos) OVER (PARTITION BY periodo, canal, provincia), 1) AS pct_pedidos,
    ROUND(pedidos * 1.0 / MAX(pedidos) OVER (PARTITION BY periodo, canal, provincia), 4)   AS nivel,
    ROUND(monto, 2)                                                              AS monto
FROM cubo
ORDER BY periodo_tipo, periodo, canal, provincia, orden;


-- ---------------------------------------------------------------------
-- MART_USUARIOS: sesiones y usuarios activos por período.
-- Las sesiones web no tienen canal ni provincia: solo se filtran por
-- período. Usuario = cliente identificado, o la sesión si es anónima,
-- así que usuarios_activos = usuarios_identificados + usuarios_anonimos.
-- ---------------------------------------------------------------------
CREATE TABLE mart_usuarios AS
WITH base AS (
    SELECT
        d.year AS anio,
        d.month AS mes,
        w.customer_key IS NOT NULL AS identificada,
        CASE WHEN w.customer_key IS NOT NULL THEN 'C-' || w.customer_key
             ELSE 'S-' || w.session_id END AS usuario
    FROM fact_web_session AS w
    JOIN dim_date AS d ON d.date_key = w.date_key
),
cubo AS (
    SELECT
        CASE WHEN GROUPING(anio) = 1 THEN 'total' WHEN GROUPING(mes) = 1 THEN 'anio' ELSE 'mes' END AS periodo_tipo,
        CASE WHEN GROUPING(anio) = 1 THEN 'Todo'
             WHEN GROUPING(mes) = 1 THEN CAST(anio AS VARCHAR)
             ELSE printf('%04d-%02d', anio, mes) END AS periodo,
        anio,
        mes,
        COUNT(*) AS sesiones,
        SUM(CASE WHEN identificada THEN 1 ELSE 0 END) AS sesiones_identificadas,
        COUNT(DISTINCT usuario) AS usuarios_activos,
        COUNT(DISTINCT CASE WHEN identificada THEN usuario END) AS usuarios_identificados,
        COUNT(DISTINCT CASE WHEN NOT identificada THEN usuario END) AS usuarios_anonimos
    FROM base
    GROUP BY GROUPING SETS ((), (anio), (anio, mes))
)
SELECT
    periodo_tipo, periodo, anio, mes,
    sesiones,
    sesiones_identificadas,
    ROUND(sesiones_identificadas * 100.0 / sesiones, 1)                          AS pct_identificadas,
    usuarios_activos,
    usuarios_identificados,
    usuarios_anonimos,
    ROUND(usuarios_identificados * 100.0 / usuarios_activos, 1)                  AS pct_identificados,
    ROUND(usuarios_anonimos * 100.0 / usuarios_activos, 1)                       AS pct_anonimos,
    -- alto de las columnas frente al mes con más usuarios
    CASE WHEN periodo_tipo = 'mes' THEN ROUND(usuarios_activos * 1.0
        / MAX(usuarios_activos) OVER (PARTITION BY periodo_tipo), 4) END         AS nivel_mes,
    CASE WHEN periodo_tipo = 'mes' THEN ROUND(usuarios_identificados * 1.0
        / MAX(usuarios_activos) OVER (PARTITION BY periodo_tipo), 4) END         AS nivel_mes_identificados,
    CASE WHEN periodo_tipo = 'mes' THEN ROUND(usuarios_anonimos * 1.0
        / MAX(usuarios_activos) OVER (PARTITION BY periodo_tipo), 4) END         AS nivel_mes_anonimos,
    CASE WHEN periodo_tipo = 'mes' AND usuarios_activos
        = MAX(usuarios_activos) OVER (PARTITION BY periodo_tipo) THEN 1 ELSE 0 END AS es_maximo
FROM cubo
ORDER BY periodo_tipo, periodo;


-- ---------------------------------------------------------------------
-- MART_TRAFICO: sesiones por origen y dispositivo, para cada período.
-- ---------------------------------------------------------------------
CREATE TABLE mart_trafico AS
WITH base AS (
    SELECT d.year AS anio, d.month AS mes, ts.nombre AS origen, ts.campania, dv.nombre AS dispositivo
    FROM fact_web_session AS w
    JOIN dim_date AS d ON d.date_key = w.date_key
    JOIN dim_traffic_source AS ts ON ts.source_key = w.source_key
    JOIN dim_device AS dv ON dv.device_key = w.device_key
),
cubo AS (
    SELECT
        CASE WHEN GROUPING(anio) = 1 THEN 'total' WHEN GROUPING(mes) = 1 THEN 'anio' ELSE 'mes' END AS periodo_tipo,
        CASE WHEN GROUPING(anio) = 1 THEN 'Todo'
             WHEN GROUPING(mes) = 1 THEN CAST(anio AS VARCHAR)
             ELSE printf('%04d-%02d', anio, mes) END AS periodo,
        origen, campania, dispositivo,
        COUNT(*) AS sesiones
    FROM base
    GROUP BY origen, campania, dispositivo, GROUPING SETS ((), (anio), (anio, mes))
)
SELECT
    periodo_tipo, periodo, origen, campania, dispositivo,
    sesiones,
    SUM(sesiones) OVER (PARTITION BY periodo, origen)                            AS sesiones_origen,
    ROUND(sesiones * 100.0 / SUM(sesiones) OVER (PARTITION BY periodo, origen), 1) AS pct_del_origen,
    -- largo de la barra del origen frente al origen con más sesiones del período
    ROUND(SUM(sesiones) OVER (PARTITION BY periodo, origen) * 1.0
        / MAX(sesiones_origen) OVER (PARTITION BY periodo), 4)                   AS nivel_origen
FROM (
    SELECT *, SUM(sesiones) OVER (PARTITION BY periodo, origen) AS sesiones_origen FROM cubo
)
ORDER BY periodo_tipo, periodo, sesiones_origen DESC, origen, sesiones DESC;


-- ---------------------------------------------------------------------
-- MART_NPS: NPS y su composición por período y canal.
-- La encuesta no tiene provincia: solo se filtra por período y canal.
-- ---------------------------------------------------------------------
CREATE TABLE mart_nps AS
WITH base AS (
    SELECT d.year AS anio, d.month AS mes, ch.name AS canal, n.score
    FROM fact_nps AS n
    JOIN dim_date AS d ON d.date_key = n.date_key
    JOIN dim_channel AS ch ON ch.channel_key = n.channel_key
),
cubo AS (
    SELECT
        CASE WHEN GROUPING(anio) = 1 THEN 'total' WHEN GROUPING(mes) = 1 THEN 'anio' ELSE 'mes' END AS periodo_tipo,
        CASE WHEN GROUPING(anio) = 1 THEN 'Todo'
             WHEN GROUPING(mes) = 1 THEN CAST(anio AS VARCHAR)
             ELSE printf('%04d-%02d', anio, mes) END AS periodo,
        anio,
        mes,
        CASE WHEN GROUPING(canal) = 1 THEN 'Todos' ELSE canal END AS canal,
        COUNT(*) AS respuestas,
        SUM(CASE WHEN score >= 9 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS pct_promotores,
        SUM(CASE WHEN score BETWEEN 7 AND 8 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS pct_pasivos,
        SUM(CASE WHEN score <= 6 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS pct_detractores
    FROM base
    GROUP BY GROUPING SETS ((), (anio), (anio, mes)), CUBE (canal)
)
SELECT
    periodo_tipo, periodo, anio, mes, canal,
    respuestas,
    ROUND(pct_promotores - pct_detractores, 1)                                   AS nps,
    ROUND(pct_promotores, 1)                                                     AS pct_promotores,
    ROUND(pct_pasivos, 1)                                                        AS pct_pasivos,
    ROUND(pct_detractores, 1)                                                    AS pct_detractores,
    CASE WHEN periodo_tipo = 'mes' AND pct_promotores - pct_detractores
        = MIN(pct_promotores - pct_detractores) OVER (PARTITION BY periodo_tipo, canal) THEN 1 ELSE 0 END AS es_minimo
FROM cubo
ORDER BY periodo_tipo, periodo, canal;


-- ---------------------------------------------------------------------
-- MART_PAGOS: pagos y tasa de fallos por medio de pago, para cada
-- período, canal y provincia (la provincia sale del pedido). La fila
-- con metodo = 'Todos' es el total de la selección.
-- ---------------------------------------------------------------------
CREATE TABLE mart_pagos AS
WITH base AS (
    SELECT
        d.year AS anio,
        d.month AS mes,
        ch.name AS canal,
        p.name AS provincia,
        pm.nombre AS metodo,
        pa.status = 'FAILED' AS fallido
    FROM fact_payment AS pa
    JOIN fact_sales_order AS o ON o.order_id = pa.order_id
    JOIN dim_date AS d ON d.date_key = pa.date_key
    JOIN dim_channel AS ch ON ch.channel_key = pa.channel_key
    JOIN dim_province AS p ON p.province_key = o.province_key
    JOIN dim_payment_method AS pm ON pm.payment_method_key = pa.payment_method_key
),
cubo AS (
    SELECT
        CASE WHEN GROUPING(anio) = 1 THEN 'total' WHEN GROUPING(mes) = 1 THEN 'anio' ELSE 'mes' END AS periodo_tipo,
        CASE WHEN GROUPING(anio) = 1 THEN 'Todo'
             WHEN GROUPING(mes) = 1 THEN CAST(anio AS VARCHAR)
             ELSE printf('%04d-%02d', anio, mes) END AS periodo,
        CASE WHEN GROUPING(canal) = 1 THEN 'Todos' ELSE canal END AS canal,
        CASE WHEN GROUPING(provincia) = 1 THEN 'Todas' ELSE provincia END AS provincia,
        CASE WHEN GROUPING(metodo) = 1 THEN 'Todos' ELSE metodo END AS metodo,
        COUNT(*) AS pagos,
        SUM(CASE WHEN fallido THEN 1 ELSE 0 END) AS fallidos
    FROM base
    GROUP BY GROUPING SETS ((), (anio), (anio, mes)), CUBE (canal, provincia, metodo)
)
SELECT
    periodo_tipo, periodo, canal, provincia, metodo,
    pagos,
    fallidos,
    ROUND(fallidos * 100.0 / pagos, 1)                                           AS tasa_fallos,
    CASE WHEN metodo <> 'Todos' THEN ROUND(pagos * 1.0
        / MAX(CASE WHEN metodo <> 'Todos' THEN pagos END) OVER (PARTITION BY periodo, canal, provincia), 4) END AS nivel
FROM cubo
ORDER BY periodo_tipo, periodo, canal, provincia, pagos DESC;


-- ---------------------------------------------------------------------
-- MART_ENTREGAS: días promedio entre el pedido y la entrega (solo
-- envíos entregados), por período, canal y provincia.
-- ---------------------------------------------------------------------
CREATE TABLE mart_entregas AS
WITH base AS (
    SELECT d.year AS anio, d.month AS mes, ch.name AS canal, p.name AS provincia, s.delivery_days
    FROM fact_shipment AS s
    JOIN dim_date AS d ON d.date_key = s.date_key
    JOIN dim_channel AS ch ON ch.channel_key = s.channel_key
    JOIN dim_province AS p ON p.province_key = s.province_key
    WHERE s.status = 'DELIVERED'
),
cubo AS (
    SELECT
        CASE WHEN GROUPING(anio) = 1 THEN 'total' WHEN GROUPING(mes) = 1 THEN 'anio' ELSE 'mes' END AS periodo_tipo,
        CASE WHEN GROUPING(anio) = 1 THEN 'Todo'
             WHEN GROUPING(mes) = 1 THEN CAST(anio AS VARCHAR)
             ELSE printf('%04d-%02d', anio, mes) END AS periodo,
        CASE WHEN GROUPING(canal) = 1 THEN 'Todos' ELSE canal END AS canal,
        CASE WHEN GROUPING(provincia) = 1 THEN 'Todas' ELSE provincia END AS provincia,
        COUNT(*) AS envios_entregados,
        AVG(delivery_days) AS dias_promedio
    FROM base
    GROUP BY GROUPING SETS ((), (anio), (anio, mes)), CUBE (canal, provincia)
)
SELECT
    periodo_tipo, periodo, canal, provincia,
    envios_entregados,
    ROUND(dias_promedio, 1)                                                      AS dias_promedio,
    CASE WHEN provincia <> 'Todas' AND dias_promedio = MAX(CASE WHEN provincia <> 'Todas' THEN dias_promedio END)
        OVER (PARTITION BY periodo, canal) THEN 1 ELSE 0 END                     AS es_mas_lenta
FROM cubo
ORDER BY periodo_tipo, periodo, canal, provincia;


-- ---------------------------------------------------------------------
-- MART_COMPRAS_ESTADO_CLIENTE: qué productos compran los clientes
-- activos y los que dieron de baja su cuenta.
-- ---------------------------------------------------------------------
CREATE TABLE mart_compras_estado_cliente AS
WITH base AS (
    SELECT
        d.year AS anio,
        d.month AS mes,
        ch.name AS canal,
        p.name AS provincia,
        CASE WHEN c.status = 'I' THEN 'Inactivos' ELSE 'Activos' END AS estado_cliente,
        pr.name AS producto,
        CAST(i.line_total AS DOUBLE) * o.total_amount / o.subtotal AS ventas
    FROM fact_sales_order_item AS i
    JOIN fact_sales_order AS o ON o.order_id = i.order_id
    JOIN dim_customer AS c ON c.customer_key = o.customer_key
    JOIN dim_date AS d ON d.date_key = o.date_key
    JOIN dim_channel AS ch ON ch.channel_key = o.channel_key
    JOIN dim_province AS p ON p.province_key = o.province_key
    JOIN dim_product AS pr ON pr.product_key = i.product_key
    WHERE o.status IN ('PAID', 'FULFILLED')
),
cubo AS (
    SELECT
        CASE WHEN GROUPING(anio) = 1 THEN 'total' WHEN GROUPING(mes) = 1 THEN 'anio' ELSE 'mes' END AS periodo_tipo,
        CASE WHEN GROUPING(anio) = 1 THEN 'Todo'
             WHEN GROUPING(mes) = 1 THEN CAST(anio AS VARCHAR)
             ELSE printf('%04d-%02d', anio, mes) END AS periodo,
        CASE WHEN GROUPING(canal) = 1 THEN 'Todos' ELSE canal END AS canal,
        CASE WHEN GROUPING(provincia) = 1 THEN 'Todas' ELSE provincia END AS provincia,
        estado_cliente,
        producto,
        SUM(ventas) AS ventas
    FROM base
    GROUP BY estado_cliente, producto, GROUPING SETS ((), (anio), (anio, mes)), CUBE (canal, provincia)
)
SELECT
    periodo_tipo, periodo, canal, provincia, estado_cliente, producto,
    ROUND(ventas, 2)                                                             AS ventas,
    ROUND(ventas * 100.0 / SUM(ventas) OVER (PARTITION BY periodo, canal, provincia, estado_cliente), 1) AS pct_del_estado
FROM cubo
ORDER BY periodo_tipo, periodo, canal, provincia, estado_cliente, producto;


-- ---------------------------------------------------------------------
-- MART_CLIENTES: cómo se reparten clientes y ventas según tres miradas
-- (frecuencia de compra, valor del cliente y tipo de compra).
-- Es una foto del período completo: no se filtra.
-- ---------------------------------------------------------------------
CREATE TABLE mart_clientes AS
WITH ventas AS (
    SELECT customer_key, order_id, date_key, total_amount
    FROM fact_sales_order
    WHERE status IN ('PAID', 'FULFILLED')
),
por_cliente AS (
    SELECT customer_key, COUNT(*) AS pedidos, SUM(total_amount) AS ventas
    FROM ventas
    GROUP BY customer_key
),
clasificados AS (
    SELECT
        customer_key, pedidos, ventas,
        CASE WHEN pedidos = 1 THEN '1 compra'
             WHEN pedidos <= 3 THEN '2 a 3 compras'
             ELSE '4 o más compras' END AS frecuencia,
        CASE WHEN NTILE(5) OVER (ORDER BY ventas DESC, customer_key) = 1
             THEN 'Top 20 % de clientes' ELSE 'Resto de clientes' END AS segmento
    FROM por_cliente
),
compras AS (
    SELECT
        total_amount,
        CASE WHEN ROW_NUMBER() OVER (PARTITION BY customer_key ORDER BY date_key, order_id) = 1
             THEN 'Primera compra' ELSE 'Recompra' END AS tipo
    FROM ventas
),
grupos AS (
    SELECT 'Frecuencia' AS grupo, frecuencia AS categoria,
           CASE frecuencia WHEN '1 compra' THEN 1 WHEN '2 a 3 compras' THEN 2 ELSE 3 END AS orden,
           COUNT(*) AS cantidad, SUM(ventas) AS ventas
    FROM clasificados GROUP BY frecuencia
    UNION ALL
    SELECT 'Valor', segmento, CASE WHEN segmento LIKE 'Top%' THEN 1 ELSE 2 END, COUNT(*), SUM(ventas)
    FROM clasificados GROUP BY segmento
    UNION ALL
    SELECT 'Tipo de compra', tipo, CASE WHEN tipo = 'Primera compra' THEN 1 ELSE 2 END, COUNT(*), SUM(total_amount)
    FROM compras GROUP BY tipo
)
SELECT
    grupo, categoria, orden, cantidad,
    ROUND(cantidad * 100.0 / SUM(cantidad) OVER (PARTITION BY grupo), 1) AS pct_cantidad,
    ROUND(ventas, 2)                                                     AS ventas,
    ROUND(ventas * 100.0 / SUM(ventas) OVER (PARTITION BY grupo), 1)     AS pct_ventas
FROM grupos
ORDER BY grupo, orden;


-- ---------------------------------------------------------------------
-- MART_PERIODO: datos fijos del período completo (fechas y clientes
-- recurrentes), para títulos y tarjetas que no dependen de filtros.
-- ---------------------------------------------------------------------
CREATE TABLE mart_periodo AS
WITH por_cliente AS (
    SELECT customer_key, COUNT(*) AS pedidos
    FROM fact_sales_order
    WHERE status IN ('PAID', 'FULFILLED')
    GROUP BY customer_key
)
SELECT
    (SELECT MIN(d.fecha) FROM fact_sales_order f JOIN dim_date d ON d.date_key = f.date_key) AS desde,
    (SELECT MAX(d.fecha) FROM fact_sales_order f JOIN dim_date d ON d.date_key = f.date_key) AS hasta,
    COUNT(*)                                                                    AS clientes_compradores,
    ROUND(SUM(CASE WHEN pedidos >= 2 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1)  AS pct_clientes_recurrentes
FROM por_cliente;
