-- =====================================================================
-- 05_calidad.sql — Controles de calidad de los datos
-- =====================================================================
-- Se ejecuta al final, cuando ya existen el modelo estrella y los marts.
-- No crea tablas: solo consultas que muestran el resultado de cada
-- control en la terminal. En todas, la columna "estado" dice OK si el
-- control pasó o REVISAR si encontró un problema.
--
--   1. Duplicados:   ninguna clave primaria se repite.
--   2. Nulos:        cuántas FK vienen vacías y si eso es esperable.
--   3. Integridad:   ninguna FK apunta a una fila que no existe.
--   4. Conciliación: el DW tiene las mismas filas y montos que raw.
--   5. Conciliación de los marts contra el modelo estrella.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. DUPLICADOS: filas totales contra claves distintas, por tabla
-- ---------------------------------------------------------------------
SELECT tabla, filas, claves_distintas, filas - claves_distintas AS duplicados,
       CASE WHEN filas = claves_distintas THEN 'OK' ELSE 'REVISAR' END AS estado
FROM (
    SELECT 'dim_channel' AS tabla, COUNT(*) AS filas, COUNT(DISTINCT channel_key) AS claves_distintas FROM dim_channel
    UNION ALL SELECT 'dim_customer', COUNT(*), COUNT(DISTINCT customer_key) FROM dim_customer
    UNION ALL SELECT 'dim_date', COUNT(*), COUNT(DISTINCT date_key) FROM dim_date
    UNION ALL SELECT 'dim_device', COUNT(*), COUNT(DISTINCT device_key) FROM dim_device
    UNION ALL SELECT 'dim_payment_method', COUNT(*), COUNT(DISTINCT payment_method_key) FROM dim_payment_method
    UNION ALL SELECT 'dim_product', COUNT(*), COUNT(DISTINCT product_key) FROM dim_product
    UNION ALL SELECT 'dim_province', COUNT(*), COUNT(DISTINCT province_key) FROM dim_province
    UNION ALL SELECT 'dim_store', COUNT(*), COUNT(DISTINCT store_key) FROM dim_store
    UNION ALL SELECT 'dim_traffic_source', COUNT(*), COUNT(DISTINCT source_key) FROM dim_traffic_source
    UNION ALL SELECT 'fact_sales_order', COUNT(*), COUNT(DISTINCT order_id) FROM fact_sales_order
    UNION ALL SELECT 'fact_sales_order_item', COUNT(*), COUNT(DISTINCT order_item_id) FROM fact_sales_order_item
    UNION ALL SELECT 'fact_web_session', COUNT(*), COUNT(DISTINCT session_id) FROM fact_web_session
    UNION ALL SELECT 'fact_nps', COUNT(*), COUNT(DISTINCT nps_id) FROM fact_nps
    UNION ALL SELECT 'fact_payment', COUNT(*), COUNT(DISTINCT payment_id) FROM fact_payment
    UNION ALL SELECT 'fact_shipment', COUNT(*), COUNT(DISTINCT shipment_id) FROM fact_shipment
)
ORDER BY tabla;


-- ---------------------------------------------------------------------
-- 2. NULOS EN LAS FK: cuántas vienen vacías y si es esperable
--    store_key vacío = venta online; customer_key vacío = anónimo.
-- ---------------------------------------------------------------------
SELECT tabla, fk, filas, nulos, ROUND(nulos * 100.0 / filas, 1) AS pct_nulos, esperable,
       CASE WHEN nulos = 0 OR esperable <> 'No debería haber nulos' THEN 'OK' ELSE 'REVISAR' END AS estado
FROM (
    SELECT 'fact_sales_order' AS tabla, 'date_key' AS fk, COUNT(*) AS filas, COUNT(*) - COUNT(date_key) AS nulos, 'No debería haber nulos' AS esperable FROM fact_sales_order
    UNION ALL SELECT 'fact_sales_order', 'customer_key', COUNT(*), COUNT(*) - COUNT(customer_key), 'No debería haber nulos' FROM fact_sales_order
    UNION ALL SELECT 'fact_sales_order', 'channel_key', COUNT(*), COUNT(*) - COUNT(channel_key), 'No debería haber nulos' FROM fact_sales_order
    UNION ALL SELECT 'fact_sales_order', 'store_key', COUNT(*), COUNT(*) - COUNT(store_key), 'Sí: los pedidos online no tienen tienda' FROM fact_sales_order
    UNION ALL SELECT 'fact_sales_order', 'province_key', COUNT(*), COUNT(*) - COUNT(province_key), 'No debería haber nulos' FROM fact_sales_order
    UNION ALL SELECT 'fact_sales_order_item', 'product_key', COUNT(*), COUNT(*) - COUNT(product_key), 'No debería haber nulos' FROM fact_sales_order_item
    UNION ALL SELECT 'fact_web_session', 'customer_key', COUNT(*), COUNT(*) - COUNT(customer_key), 'Sí: visitantes que no iniciaron sesión' FROM fact_web_session
    UNION ALL SELECT 'fact_web_session', 'source_key', COUNT(*), COUNT(*) - COUNT(source_key), 'No debería haber nulos' FROM fact_web_session
    UNION ALL SELECT 'fact_web_session', 'device_key', COUNT(*), COUNT(*) - COUNT(device_key), 'No debería haber nulos' FROM fact_web_session
    UNION ALL SELECT 'fact_nps', 'customer_key', COUNT(*), COUNT(*) - COUNT(customer_key), 'Sí: respuestas anónimas' FROM fact_nps
    UNION ALL SELECT 'fact_nps', 'channel_key', COUNT(*), COUNT(*) - COUNT(channel_key), 'No debería haber nulos' FROM fact_nps
    UNION ALL SELECT 'fact_payment', 'payment_method_key', COUNT(*), COUNT(*) - COUNT(payment_method_key), 'No debería haber nulos' FROM fact_payment
    UNION ALL SELECT 'fact_shipment', 'province_key', COUNT(*), COUNT(*) - COUNT(province_key), 'No debería haber nulos' FROM fact_shipment
    UNION ALL SELECT 'fact_shipment', 'delivery_days', COUNT(*), COUNT(*) - COUNT(delivery_days), 'Sí: solo los envíos entregados tienen días de entrega' FROM fact_shipment
)
ORDER BY tabla, fk;


-- ---------------------------------------------------------------------
-- 3. INTEGRIDAD: FK con valor que no existe en su dimensión
-- ---------------------------------------------------------------------
SELECT relacion, huerfanas, CASE WHEN huerfanas = 0 THEN 'OK' ELSE 'REVISAR' END AS estado
FROM (
    SELECT 'fact_sales_order.date_key -> dim_date' AS relacion, COUNT(*) AS huerfanas
    FROM fact_sales_order f LEFT JOIN dim_date d ON d.date_key = f.date_key WHERE f.date_key IS NOT NULL AND d.date_key IS NULL
    UNION ALL SELECT 'fact_sales_order.customer_key -> dim_customer', COUNT(*)
    FROM fact_sales_order f LEFT JOIN dim_customer d ON d.customer_key = f.customer_key WHERE f.customer_key IS NOT NULL AND d.customer_key IS NULL
    UNION ALL SELECT 'fact_sales_order.store_key -> dim_store', COUNT(*)
    FROM fact_sales_order f LEFT JOIN dim_store d ON d.store_key = f.store_key WHERE f.store_key IS NOT NULL AND d.store_key IS NULL
    UNION ALL SELECT 'fact_sales_order.province_key -> dim_province', COUNT(*)
    FROM fact_sales_order f LEFT JOIN dim_province d ON d.province_key = f.province_key WHERE f.province_key IS NOT NULL AND d.province_key IS NULL
    UNION ALL SELECT 'fact_sales_order_item.product_key -> dim_product', COUNT(*)
    FROM fact_sales_order_item f LEFT JOIN dim_product d ON d.product_key = f.product_key WHERE f.product_key IS NOT NULL AND d.product_key IS NULL
    UNION ALL SELECT 'fact_sales_order_item.order_id -> fact_sales_order', COUNT(*)
    FROM fact_sales_order_item f LEFT JOIN fact_sales_order o ON o.order_id = f.order_id WHERE o.order_id IS NULL
    UNION ALL SELECT 'fact_web_session.source_key -> dim_traffic_source', COUNT(*)
    FROM fact_web_session f LEFT JOIN dim_traffic_source d ON d.source_key = f.source_key WHERE f.source_key IS NOT NULL AND d.source_key IS NULL
    UNION ALL SELECT 'fact_web_session.device_key -> dim_device', COUNT(*)
    FROM fact_web_session f LEFT JOIN dim_device d ON d.device_key = f.device_key WHERE f.device_key IS NOT NULL AND d.device_key IS NULL
    UNION ALL SELECT 'fact_nps.channel_key -> dim_channel', COUNT(*)
    FROM fact_nps f LEFT JOIN dim_channel d ON d.channel_key = f.channel_key WHERE f.channel_key IS NOT NULL AND d.channel_key IS NULL
    UNION ALL SELECT 'fact_payment.payment_method_key -> dim_payment_method', COUNT(*)
    FROM fact_payment f LEFT JOIN dim_payment_method d ON d.payment_method_key = f.payment_method_key WHERE f.payment_method_key IS NOT NULL AND d.payment_method_key IS NULL
    UNION ALL SELECT 'fact_payment.order_id -> fact_sales_order', COUNT(*)
    FROM fact_payment f LEFT JOIN fact_sales_order o ON o.order_id = f.order_id WHERE o.order_id IS NULL
    UNION ALL SELECT 'fact_shipment.order_id -> fact_sales_order', COUNT(*)
    FROM fact_shipment f LEFT JOIN fact_sales_order o ON o.order_id = f.order_id WHERE o.order_id IS NULL
)
ORDER BY relacion;


-- ---------------------------------------------------------------------
-- 4. CONCILIACIÓN RAW CONTRA DW: mismas filas y mismos montos
-- ---------------------------------------------------------------------
SELECT control, en_raw, en_dw, en_raw - en_dw AS diferencia,
       CASE WHEN en_raw = en_dw THEN 'OK' ELSE 'REVISAR' END AS estado
FROM (
    SELECT 'Pedidos (filas)' AS control,
           (SELECT COUNT(*) FROM raw.sales_order) AS en_raw, (SELECT COUNT(*) FROM fact_sales_order) AS en_dw
    UNION ALL SELECT 'Ítems de pedido (filas)',
           (SELECT COUNT(*) FROM raw.sales_order_item), (SELECT COUNT(*) FROM fact_sales_order_item)
    UNION ALL SELECT 'Sesiones web (filas)',
           (SELECT COUNT(*) FROM raw.web_session), (SELECT COUNT(*) FROM fact_web_session)
    UNION ALL SELECT 'Respuestas NPS (filas)',
           (SELECT COUNT(*) FROM raw.nps_response), (SELECT COUNT(*) FROM fact_nps)
    UNION ALL SELECT 'Pagos (filas)',
           (SELECT COUNT(*) FROM raw.payment), (SELECT COUNT(*) FROM fact_payment)
    UNION ALL SELECT 'Envíos (filas)',
           (SELECT COUNT(*) FROM raw.shipment), (SELECT COUNT(*) FROM fact_shipment)
    UNION ALL SELECT 'Clientes (filas)',
           (SELECT COUNT(*) FROM raw.customer), (SELECT COUNT(*) FROM dim_customer)
    UNION ALL SELECT 'Ventas cobradas ($)',
           (SELECT SUM(total_amount) FROM raw.sales_order WHERE status IN ('PAID', 'FULFILLED')),
           (SELECT SUM(total_amount) FROM fact_sales_order WHERE status IN ('PAID', 'FULFILLED'))
    UNION ALL SELECT 'IVA cobrado ($)',
           (SELECT SUM(tax_amount) FROM raw.sales_order WHERE status IN ('PAID', 'FULFILLED')),
           (SELECT SUM(tax_amount) FROM fact_sales_order WHERE status IN ('PAID', 'FULFILLED'))
);


-- ---------------------------------------------------------------------
-- 5. CONCILIACIÓN DE LOS MARTS contra el modelo estrella y entre sí
-- ---------------------------------------------------------------------
SELECT control, esperado, obtenido, ROUND(esperado - obtenido, 2) AS diferencia,
       CASE WHEN ABS(esperado - obtenido) < 0.01 THEN 'OK' ELSE 'REVISAR' END AS estado
FROM (
    SELECT 'mart_ventas: ventas totales = fact_sales_order' AS control,
           (SELECT SUM(total_amount) FROM fact_sales_order WHERE status IN ('PAID', 'FULFILLED')) AS esperado,
           (SELECT ventas FROM mart_ventas WHERE periodo = 'Todo' AND canal = 'Todos' AND provincia = 'Todas') AS obtenido
    UNION ALL SELECT 'mart_ventas: productos + envíos + IVA = ventas',
           (SELECT ventas FROM mart_ventas WHERE periodo = 'Todo' AND canal = 'Todos' AND provincia = 'Todas'),
           (SELECT productos + envios + iva FROM mart_ventas WHERE periodo = 'Todo' AND canal = 'Todos' AND provincia = 'Todas')
    UNION ALL SELECT 'mart_ventas: suma de provincias = total',
           (SELECT ventas FROM mart_ventas WHERE periodo = 'Todo' AND canal = 'Todos' AND provincia = 'Todas'),
           (SELECT SUM(ventas) FROM mart_ventas WHERE periodo = 'Todo' AND canal = 'Todos' AND provincia <> 'Todas')
    UNION ALL SELECT 'mart_ventas: suma de meses = total',
           (SELECT ventas FROM mart_ventas WHERE periodo = 'Todo' AND canal = 'Todos' AND provincia = 'Todas'),
           (SELECT SUM(ventas) FROM mart_ventas WHERE periodo_tipo = 'mes' AND canal = 'Todos' AND provincia = 'Todas')
    UNION ALL SELECT 'mart_productos: suma de productos = ventas totales',
           (SELECT ventas FROM mart_ventas WHERE periodo = 'Todo' AND canal = 'Todos' AND provincia = 'Todas'),
           (SELECT ROUND(SUM(ventas), 2) FROM mart_productos WHERE periodo = 'Todo' AND canal = 'Todos' AND provincia = 'Todas')
    UNION ALL SELECT 'mart_usuarios: identificados + anónimos = total',
           (SELECT usuarios_activos FROM mart_usuarios WHERE periodo = 'Todo'),
           (SELECT usuarios_identificados + usuarios_anonimos FROM mart_usuarios WHERE periodo = 'Todo')
    UNION ALL SELECT 'mart_estados: suma de estados = pedidos totales',
           (SELECT COUNT(*) FROM fact_sales_order),
           (SELECT SUM(pedidos) FROM mart_estados WHERE periodo = 'Todo' AND canal = 'Todos' AND provincia = 'Todas')
    UNION ALL SELECT 'mart_pagos: pagos = fact_payment',
           (SELECT COUNT(*) FROM fact_payment),
           (SELECT pagos FROM mart_pagos WHERE periodo = 'Todo' AND canal = 'Todos' AND provincia = 'Todas' AND metodo = 'Todos')
);
