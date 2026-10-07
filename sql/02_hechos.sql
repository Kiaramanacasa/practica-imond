-- =====================================================================
-- 02_hechos.sql — Tablas de HECHOS del modelo estrella
-- =====================================================================
-- Se ejecuta después de 01_dimensiones.sql porque los hechos apuntan
-- a las dimensiones con FOREIGN KEY (REFERENCES).
-- =====================================================================


-- ---------------------------------------------------------------------
-- FACT_SALES_ORDER
-- Grano: UNA FILA POR PEDIDO
-- La provincia sale de la dirección de envío del pedido.
-- ---------------------------------------------------------------------
CREATE TABLE fact_sales_order (
    order_id     BIGINT PRIMARY KEY,
    date_key     INTEGER REFERENCES dim_date(date_key),
    customer_key INTEGER REFERENCES dim_customer(customer_key),
    channel_key  INTEGER REFERENCES dim_channel(channel_key),
    store_key    INTEGER REFERENCES dim_store(store_key),
    province_key INTEGER REFERENCES dim_province(province_key),
    subtotal     DECIMAL(12, 2),
    tax_amount   DECIMAL(12, 2),
    shipping_fee DECIMAL(12, 2),
    total_amount DECIMAL(12, 2),
    status       VARCHAR
);

INSERT INTO fact_sales_order
SELECT
    o.order_id,
    d.date_key,
    c.customer_key,
    ch.channel_key,
    s.store_key,
    p.province_key,
    o.subtotal,
    o.tax_amount,
    o.shipping_fee,
    o.total_amount,
    o.status
FROM raw.sales_order AS o
JOIN dim_date AS d
    ON d.fecha = CAST(o.order_date AS DATE)
LEFT JOIN dim_customer AS c
    ON c.customer_id = o.customer_id
JOIN dim_channel AS ch
    ON ch.channel_id = o.channel_id
LEFT JOIN dim_store AS s
    ON s.store_id = o.store_id
LEFT JOIN raw.address AS a
    ON a.address_id = o.shipping_address_id
LEFT JOIN dim_province AS p
    ON p.province_id = a.province_id;


-- ---------------------------------------------------------------------
-- FACT_SALES_ORDER_ITEM
-- Grano: UNA FILA POR PRODUCTO DENTRO DE UN PEDIDO
-- ---------------------------------------------------------------------
CREATE TABLE fact_sales_order_item (
    order_item_id   BIGINT PRIMARY KEY,
    order_id        BIGINT,
    date_key        INTEGER REFERENCES dim_date(date_key),
    product_key     INTEGER REFERENCES dim_product(product_key),
    customer_key    INTEGER REFERENCES dim_customer(customer_key),
    channel_key     INTEGER REFERENCES dim_channel(channel_key),
    store_key       INTEGER REFERENCES dim_store(store_key),
    quantity        INTEGER,
    unit_price      DECIMAL(12, 2),
    discount_amount DECIMAL(12, 2),
    line_total      DECIMAL(12, 2)
);

INSERT INTO fact_sales_order_item
SELECT
    i.order_item_id,
    i.order_id,
    d.date_key,
    p.product_key,
    c.customer_key,
    ch.channel_key,
    s.store_key,
    i.quantity,
    i.unit_price,
    i.discount_amount,
    i.line_total
FROM raw.sales_order_item AS i
JOIN raw.sales_order AS o
    ON o.order_id = i.order_id
JOIN dim_date AS d
    ON d.fecha = CAST(o.order_date AS DATE)
JOIN dim_product AS p
    ON p.product_id = i.product_id
LEFT JOIN dim_customer AS c
    ON c.customer_id = o.customer_id
JOIN dim_channel AS ch
    ON ch.channel_id = o.channel_id
LEFT JOIN dim_store AS s
    ON s.store_id = o.store_id;


-- ---------------------------------------------------------------------
-- FACT_WEB_SESSION
-- Grano: UNA FILA POR SESIÓN WEB
-- customer_key queda vacío en las sesiones anónimas.
-- ---------------------------------------------------------------------
CREATE TABLE fact_web_session (
    session_id   BIGINT PRIMARY KEY,
    date_key     INTEGER REFERENCES dim_date(date_key),
    customer_key INTEGER REFERENCES dim_customer(customer_key),
    source       VARCHAR,
    device       VARCHAR,
    started_at   TIMESTAMP,
    ended_at     TIMESTAMP
);

INSERT INTO fact_web_session
SELECT
    w.session_id,
    d.date_key,
    c.customer_key,
    w.source,
    w.device,
    w.started_at,
    w.ended_at
FROM raw.web_session AS w
JOIN dim_date AS d
    ON d.fecha = CAST(w.started_at AS DATE)
LEFT JOIN dim_customer AS c
    ON c.customer_id = w.customer_id;


-- ---------------------------------------------------------------------
-- FACT_NPS
-- Grano: UNA FILA POR RESPUESTA NPS
-- ---------------------------------------------------------------------
CREATE TABLE fact_nps (
    nps_id       BIGINT PRIMARY KEY,
    date_key     INTEGER REFERENCES dim_date(date_key),
    customer_key INTEGER REFERENCES dim_customer(customer_key),
    channel_key  INTEGER REFERENCES dim_channel(channel_key),
    score        INTEGER,
    comment      VARCHAR,
    responded_at TIMESTAMP
);

INSERT INTO fact_nps
SELECT
    n.nps_id,
    d.date_key,
    c.customer_key,
    ch.channel_key,
    n.score,
    n.comment,
    n.responded_at
FROM raw.nps_response AS n
JOIN dim_date AS d
    ON d.fecha = CAST(n.responded_at AS DATE)
LEFT JOIN dim_customer AS c
    ON c.customer_id = n.customer_id
JOIN dim_channel AS ch
    ON ch.channel_id = n.channel_id;
