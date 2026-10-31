-- =====================================================================
-- 03_consultas.sql — Consultas de control y KPIs del dashboard
-- =====================================================================
-- Ventas, ticket promedio y rankings consideran solo pedidos cobrados:
-- status PAID o FULFILLED (se excluyen CREATED, CANCELLED y REFUNDED).
-- =====================================================================


-- Control: revisar la dimensión producto
SELECT product_key, name, category, family, list_price
FROM dim_product
ORDER BY product_key;


-- KPI 1 — Ventas totales
SELECT
    SUM(total_amount) AS ventas_totales
FROM fact_sales_order
WHERE status IN ('PAID', 'FULFILLED');


-- KPI 2 — Usuarios activos de la web
-- Usuario = cliente identificado (por customer_key) o, si la sesión es
-- anónima, la propia sesión (por session_id). Por eso
-- usuarios_activos = usuarios_identificados + usuarios_anonimos.
SELECT
    COUNT(DISTINCT CASE
        WHEN customer_key IS NOT NULL THEN 'C-' || customer_key
        ELSE 'S-' || session_id
    END) AS usuarios_activos,
    COUNT(DISTINCT customer_key) AS usuarios_identificados,
    COUNT(DISTINCT CASE WHEN customer_key IS NULL THEN session_id END) AS usuarios_anonimos
FROM fact_web_session;


-- KPI 3 — Ticket promedio (ventas / cantidad de pedidos)
SELECT
    SUM(total_amount) / COUNT(*) AS ticket_promedio
FROM fact_sales_order
WHERE status IN ('PAID', 'FULFILLED');


-- KPI 4 — NPS (% promotores 9-10 menos % detractores 0-6)
SELECT
    (
        SUM(CASE WHEN score >= 9 THEN 1 ELSE 0 END) * 100.0 / COUNT(*)
        -
        SUM(CASE WHEN score <= 6 THEN 1 ELSE 0 END) * 100.0 / COUNT(*)
    ) AS nps
FROM fact_nps;


-- KPI 5 — Ventas por provincia
SELECT
    p.name AS provincia,
    SUM(f.total_amount) AS ventas
FROM fact_sales_order AS f
JOIN dim_province AS p
    ON p.province_key = f.province_key
WHERE f.status IN ('PAID', 'FULFILLED')
GROUP BY p.name
ORDER BY ventas DESC;


-- KPI 6 (paso 1) — Ventas mensuales por producto
-- Cada línea se prorratea al total del pedido (con IVA y envío), así la
-- suma por producto coincide con las ventas totales del KPI 1.
SELECT
    d.year,
    d.month,
    p.name AS producto,
    ROUND(SUM(CAST(f.line_total AS DOUBLE) * o.total_amount / o.subtotal), 2) AS ventas
FROM fact_sales_order_item AS f
JOIN dim_date AS d
    ON d.date_key = f.date_key
JOIN dim_product AS p
    ON p.product_key = f.product_key
JOIN fact_sales_order AS o
    ON o.order_id = f.order_id
WHERE o.status IN ('PAID', 'FULFILLED')
GROUP BY
    d.year,
    d.month,
    p.name
ORDER BY
    d.year,
    d.month,
    ventas DESC;


-- KPI 6 (paso 2) — Ranking mensual por producto
SELECT
    year,
    month,
    producto,
    ventas,
    RANK() OVER (
        PARTITION BY year, month
        ORDER BY ventas DESC
    ) AS ranking
FROM (
    SELECT
        d.year,
        d.month,
        p.name AS producto,
        ROUND(SUM(CAST(f.line_total AS DOUBLE) * o.total_amount / o.subtotal), 2) AS ventas
    FROM fact_sales_order_item AS f
    JOIN dim_date AS d
        ON d.date_key = f.date_key
    JOIN dim_product AS p
        ON p.product_key = f.product_key
    JOIN fact_sales_order AS o
        ON o.order_id = f.order_id
    WHERE o.status IN ('PAID', 'FULFILLED')
    GROUP BY
        d.year,
        d.month,
        p.name
)
ORDER BY
    year,
    month,
    ranking;
