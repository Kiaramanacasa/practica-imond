# EcoBottle AR: data warehouse y tablero comercial

Trabajo final de **Introducción al Marketing Online y los Negocios Digitales**. Con los datos de EcoBottle AR (botellas reutilizables, tienda online y 4 tiendas físicas) se armó un data warehouse con modelo estrella en DuckDB y un tablero en Data Studio (antes Looker Studio).

**Tablero público:** [EcoBottle AR - Tablero comercial](https://datastudio.google.com/reporting/dc87b35f-c897-49d4-818d-42b6b144ff51)

![Página 1: Resumen comercial](assets/pagina1_resumen_comercial.png)
![Página 2: Clientes y operación](assets/pagina2_clientes_operacion.png)
![Página 3: Ventas netas y clientes](assets/pagina3_ventas_netas_clientes.png)

## Estructura del repositorio

```
raw/               datos de origen: un CSV por tabla (no se modifican)
sql/               transformaciones en SQL, en orden de ejecución:
  01_dimensiones.sql   crea las 9 dimensiones
  02_hechos.sql        crea las 6 tablas de hechos
  03_consultas.sql     consultas clave de análisis
  04_tablero.sql       genera las 7 tablas planas del tablero (marts)
run_sql.py         ejecuta los archivos de sql/ y arma el data warehouse
requirements.txt   dependencias de Python (DuckDB)
dw/                salida: dimensiones, hechos, tablas del tablero (CSV) y modelo_estrella.md
assets/            capturas del tablero, modelo estrella y DER de origen
generator/         programa que creó los datos de raw/ (no hace falta usarlo)
```

## Cómo reproducirlo

Requiere Python 3 y Git. Desde la Terminal:

```
git clone https://github.com/Kiaramanacasa/practica-imond.git
cd practica-imond
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 run_sql.py
```

Esto crea `warehouse.duckdb` desde cero (no se sube a GitHub), regenera los CSV de `dw/` y redibuja `dw/modelo_estrella.md`. Las tablas `dw/tablero_*.csv` son las que se cargan en una planilla de Google Sheets y alimentan el tablero.

## Modelo estrella

![Modelo estrella](assets/modelo_estrella.png)

*La imagen es ancha: hacé clic para verla en tamaño completo. El diagrama editable está en [`dw/modelo_estrella.md`](dw/modelo_estrella.md).*

El data warehouse sigue el modelo dimensional de Kimball: **6 tablas de hechos** (pedidos, ítems de pedido, sesiones web, NPS, pagos y envíos) rodeadas por **9 dimensiones** (producto, fecha, canal, provincia, cliente, tienda, origen de tráfico, dispositivo y medio de pago). Se validó que cada hecho tiene las mismas filas que su tabla de origen, que las ventas por provincia suman el total y que los pagos están conciliados con las ventas.

## Supuestos

- **Todas las medidas se calculan en SQL.** Por requisito de la cátedra, Data Studio no tiene fórmulas ni campos calculados: solo agrega (suma, media, recuento distinto) y muestra. `sql/04_tablero.sql` deja cada medida ya calculada en 7 tablas planas.
- **Ventas = pedidos cobrados.** Ventas, ticket promedio y rankings consideran solo pedidos con estado PAID o FULFILLED. Se excluyen CREATED, CANCELLED y REFUNDED.
- **Venta neta** es la venta sin IVA.
- **Usuarios activos.** En el tablero son los usuarios distintos de las sesiones web: clientes identificados (por `customer_id`) más cada sesión anónima (por `session_id`), según la consigna. Da 73,8 mil. La consulta KPI 2 de `03_consultas.sql` cuenta solo clientes identificados y da 3.077.
- **NPS** es el porcentaje de promotores (9 a 10) menos el porcentaje de detractores (0 a 6).
- **Sesiones solo online.** Las tiendas físicas no tienen sesiones web, por eso con ese canal filtrado los usuarios dan 0.
- **Período analizado:** enero 2024 a septiembre 2025.
- **Alcance de los filtros.** Los filtros compartidos (provincia, canal, producto y fecha) se aplican solo a los gráficos cuya tabla tiene esa columna. Las sesiones y el NPS no tienen provincia ni producto. Las medidas por pedido (ticket, estados, venta neta, IVA) no tienen producto, porque un pedido puede incluir varios. La tabla de clientes no tiene fecha porque clasifica a cada cliente según todo el período. Es una decisión del modelo, no un error.
- **Fuentes del tablero.** Las 7 tablas planas se cargan en una planilla de Google Sheets (configuración regional Estados Unidos) y se conectan a Data Studio como fuentes `sh_*`.

## Diccionario de datos

Las 7 tablas planas de `dw/tablero_*.csv` se generan en `sql/04_tablero.sql`. Todas las medidas ya vienen calculadas: Data Studio solo las suma, promedia o cuenta. `fecha`, `canal`, `provincia` y `tienda` salen de las dimensiones del modelo estrella.

### tablero_ventas (una fila por producto vendido)

| Columna | Significado |
|---|---|
| `order_item_id`, `order_id` | Identificador del ítem y del pedido |
| `fecha`, `canal`, `provincia`, `tienda`, `producto` | Dimensiones de la línea |
| `cliente_estado` | "Activo" si el cliente tiene estado `A`, "Inactivo" en otro caso |
| `cantidad` | Unidades de esa línea |
| `ventas_linea` | Total de la línea del pedido (`line_total`) |
| `ventas` | Línea prorrateada al total del pedido (`line_total × total_amount / subtotal`). Es la medida que suma el tablero: así las ventas por producto coinciden con las ventas totales |

### tablero_pedidos (una fila por pedido, de todos los estados)

| Columna | Significado |
|---|---|
| `order_id`, `fecha`, `canal`, `provincia`, `tienda` | Identificador y dimensiones del pedido |
| `estado` | Estado del pedido (CREATED, PAID, FULFILLED, CANCELLED, REFUNDED) |
| `es_venta` | 1 si el pedido está PAID o FULFILLED, 0 en otro caso |
| `cliente_estado` | "Activo" o "Inactivo", igual que en tablero_ventas |
| `tipo_compra` | "Primera compra" o "Recompra", según el número de compra del cliente |
| `unidades` | Unidades del pedido |
| `venta_bruta` | Total del pedido con IVA. Solo pedidos cobrados |
| `impuestos` | IVA del pedido. Solo pedidos cobrados |
| `venta_neta` | `venta_bruta` menos `impuestos`. Solo pedidos cobrados |
| `venta_productos` | Subtotal de productos, sin envío ni impuestos. Solo pedidos cobrados |
| `envio` | Costo de envío del pedido. Solo pedidos cobrados |
| `descuentos` | Suma de los descuentos de los ítems del pedido. Solo pedidos cobrados |
| `monto_perdido` | Total de pedidos CANCELLED o REFUNDED |

### tablero_sesiones (una fila por sesión web)

| Columna | Significado |
|---|---|
| `session_id`, `fecha`, `canal` | Identificador, fecha y canal de la sesión |
| `usuario` | "C-" + id si el cliente está identificado, "S-" + id de sesión si es anónimo. Se usa para contar usuarios distintos |
| `tipo_usuario` | "Identificado" o "Anónimo" |
| `identificada` | 1 si la sesión tiene cliente identificado, 0 si no. Su promedio es el % de sesiones identificadas |
| `origen` | Origen del tráfico (direct, organic, ads, referral) |
| `dispositivo` | Dispositivo (mobile, desktop, tablet) |

### tablero_nps (una fila por respuesta de la encuesta)

| Columna | Significado |
|---|---|
| `nps_id`, `fecha`, `canal` | Identificador, fecha y canal de la respuesta |
| `puntaje` | Puntaje de 0 a 10 |
| `categoria` | Promotor (9 a 10), Pasivo (7 a 8) o Detractor (0 a 6) |
| `promotor`, `detractor` | Marcas 1/0 de cada categoría |
| `nps_valor` | +100 para promotores, 0 para pasivos y -100 para detractores. Su promedio es el NPS |

### tablero_pagos (una fila por pago)

| Columna | Significado |
|---|---|
| `payment_id`, `order_id`, `fecha`, `canal`, `provincia` | Identificadores y dimensiones |
| `metodo` | Medio de pago |
| `estado` | Estado del pago |
| `monto` | Importe del pago |
| `fallido` | 1 si el pago está FAILED, 0 en otro caso. Su promedio es la tasa de fallos |

### tablero_envios (una fila por envío)

| Columna | Significado |
|---|---|
| `shipment_id`, `order_id`, `fecha`, `canal`, `provincia`, `tienda` | Identificadores y dimensiones |
| `estado` | Estado del envío |
| `dias_entrega` | Días que tardó la entrega (campo `delivery_days` del envío) |
| `entregado` | 1 si el envío está DELIVERED, 0 en otro caso |

### tablero_clientes (una fila por cliente)

| Columna | Significado |
|---|---|
| `customer_id`, `canal`, `provincia` | Identificador y dimensiones del cliente |
| `cliente_estado` | "Activo" o "Inactivo" |
| `comprador` | 1 si el cliente hizo al menos un pedido cobrado, 0 si nunca compró |
| `pedidos` | Cantidad de pedidos cobrados |
| `recurrente` | 1 si tiene 2 o más pedidos, 0 si tiene 1 (vacío si no compró). Su promedio es el % de clientes recurrentes |
| `ventas` | Ventas acumuladas del cliente |
| `frecuencia` | "Sin compras", "1 compra", "2 a 3 compras" o "4 o más compras" |
| `segmento_valor` | "Top 20 % de clientes" (primer quintil) o "Resto de clientes" |

## Diccionario del modelo estrella

Las transformaciones están escritas en SQL (`sql/01_dimensiones.sql` y `sql/02_hechos.sql`) y las ejecuta `run_sql.py`, siguiendo la estructura de la plantilla de la cátedra, en lugar de scripts `.py` sueltos. Cada tabla se guarda como CSV en `dw/`. Las dimensiones usan una clave sustituta (`*_key`) y conservan el id de origen. Los hechos referencian las dimensiones con claves foráneas (FK).

### Dimensiones (PK = clave sustituta `*_key`)

| Tabla | Columnas (tipo) | Significado |
|---|---|---|
| `dim_channel` | `channel_key` INTEGER PK, `channel_id` INTEGER, `code` VARCHAR, `name` VARCHAR | Canales de venta: ONLINE y OFFLINE |
| `dim_customer` | `customer_key` INTEGER PK, `customer_id` INTEGER, `email`, `first_name`, `last_name`, `phone` VARCHAR, `status` VARCHAR, `created_at` TIMESTAMP | Clientes. `status`: A (activo) o I (dado de baja) |
| `dim_date` | `date_key` INTEGER PK, `fecha` DATE, `year` INTEGER, `month` INTEGER, `month_name` VARCHAR, `day` INTEGER, `day_name` VARCHAR | Calendario. `date_key` tiene formato AAAAMMDD |
| `dim_device` | `device_key` INTEGER PK, `device`, `nombre`, `tipo` VARCHAR | Dispositivo de la sesión: desktop (Computadora, Escritorio), mobile (Celular, Móvil), tablet (Tablet, Móvil) |
| `dim_payment_method` | `payment_method_key` INTEGER PK, `method`, `nombre`, `tipo` VARCHAR | Medio de pago: CARD (Tarjeta), CASH (Efectivo), GATEWAY (Mercado Pago), TRANSFER (Transferencia). `tipo` es Electrónico o Efectivo |
| `dim_product` | `product_key` INTEGER PK, `product_id` INTEGER, `sku`, `name`, `category`, `family` VARCHAR, `list_price` DECIMAL(12,2) | Productos (Classic A y Sport B), con categoría y familia. El precio de lista no incluye IVA |
| `dim_province` | `province_key` INTEGER PK, `province_id` INTEGER, `name`, `code` VARCHAR | Provincias: Buenos Aires, Córdoba, Santa Fe y Mendoza |
| `dim_store` | `store_key` INTEGER PK, `store_id` INTEGER, `name` VARCHAR, `address_id` INTEGER | Las 4 tiendas físicas. `address_id` es el id de origen de la dirección |
| `dim_traffic_source` | `source_key` INTEGER PK, `source`, `nombre`, `campania` VARCHAR | Origen del tráfico: ads (Redes sociales), direct (Email), organic (Sin campaña), referral (Email) |

### Hechos (PK = id de origen)

| Tabla | Grano | PK | FK | Medidas y atributos (tipo) |
|---|---|---|---|---|
| `fact_sales_order` | un pedido | `order_id` BIGINT | `date_key`, `customer_key`, `channel_key`, `store_key`, `province_key` | `subtotal`, `tax_amount`, `shipping_fee`, `total_amount` DECIMAL(12,2); `status` VARCHAR |
| `fact_sales_order_item` | un producto dentro de un pedido | `order_item_id` BIGINT | `date_key`, `product_key`, `customer_key`, `channel_key`, `store_key` | `order_id` BIGINT; `quantity` INTEGER; `unit_price`, `discount_amount`, `line_total` DECIMAL(12,2) |
| `fact_web_session` | una sesión web | `session_id` BIGINT | `date_key`, `customer_key`, `source_key`, `device_key` | `started_at`, `ended_at` TIMESTAMP |
| `fact_nps` | una respuesta de la encuesta | `nps_id` BIGINT | `date_key`, `customer_key`, `channel_key` | `score` INTEGER; `comment` VARCHAR; `responded_at` TIMESTAMP |
| `fact_payment` | un pago | `payment_id` BIGINT | `date_key`, `customer_key`, `channel_key`, `store_key`, `payment_method_key` | `order_id` BIGINT; `status` VARCHAR; `amount` DECIMAL(12,2); `paid_at` TIMESTAMP |
| `fact_shipment` | un envío | `shipment_id` BIGINT | `date_key`, `customer_key`, `channel_key`, `store_key`, `province_key` | `order_id` BIGINT; `carrier`, `status` VARCHAR; `shipped_at`, `delivered_at` TIMESTAMP; `delivery_days` INTEGER |

### Dominios

- `fact_sales_order.status`: CREATED, PAID, CANCELLED, FULFILLED o REFUNDED. Solo PAID y FULFILLED cuentan como venta.
- `fact_payment.status`: PENDING, PAID, FAILED o REFUNDED.
- `fact_shipment.status`: READY, SHIPPED, DELIVERED o CANCELLED.
- `fact_nps.score`: de 0 a 10. Promotor de 9 a 10, pasivo de 7 a 8 y detractor de 0 a 6.
- `store_key` vacío en los pedidos online. `customer_key` vacío en las sesiones y respuestas NPS anónimas.
- `order_id` en ítems, pagos y envíos conserva el id de origen y no es una FK hacia otra tabla del modelo.

## Consultas clave

Las consultas de control y KPIs están en [`sql/03_consultas.sql`](sql/03_consultas.sql). Todas cuentan solo pedidos cobrados (PAID o FULFILLED). Los valores de control corresponden al período completo (ene 2024 a sept 2025) y coinciden con los del tablero.

| KPI | Definición | Valor de control |
|---|---|---|
| 1. Ventas totales | Suma de ventas de pedidos cobrados | $382,41 M |
| 2. Usuarios activos | Tablero: identificados + sesiones anónimas. SQL: solo clientes identificados con sesión web | Tablero 73,8 mil. SQL (KPI 2): 3.077 |
| 3. Ticket promedio | Ventas / cantidad de pedidos | $34,77 mil |
| 4. NPS | % promotores (9 a 10) menos % detractores (0 a 6) | 30,0 |
| 5. Ventas por provincia | Ventas agrupadas por provincia | Buenos Aires $142,7 M, Córdoba $89,54 M, Santa Fe $87,55 M, Mendoza $62,63 M |
| 6. Ranking mensual por producto | Ventas mensuales por producto y posición en el ranking de cada mes | Se ve en el gráfico de la página 1 |

El código completo de cada consulta:

```sql
-- KPI 1 — Ventas totales
SELECT
    SUM(total_amount) AS ventas_totales
FROM fact_sales_order
WHERE status IN ('PAID', 'FULFILLED');


-- KPI 2 — Usuarios activos (clientes identificados con al menos una sesión web)
SELECT
    COUNT(DISTINCT customer_key) AS usuarios_activos
FROM fact_web_session
WHERE customer_key IS NOT NULL;


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
SELECT
    d.year,
    d.month,
    p.name AS producto,
    SUM(f.line_total) AS ventas
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
        SUM(f.line_total) AS ventas
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
```

## Hallazgos

Resumen del período completo (ene 2024 a sept 2025). Son los mismos tres hallazgos que figuran al pie de cada página del tablero.

### Resumen comercial

- **Ventas:** diciembre de 2024 fue el mejor mes, con $28,5 M, un 56 % más que el promedio mensual ($18,2 M).
- **Canales:** la tienda online genera el 59 % de las ventas y vende más que las cuatro tiendas físicas juntas.
- **Satisfacción:** el NPS cayó a 5 en agosto de 2024 (promedio: 30) y volvió a bajar en el último trimestre (28,3).

### Clientes y operación

- **Pagos:** Mercado Pago falla en el 9,8 % de los cobros, más del doble que la tarjeta (4,0 %).
- **Marketing:** el 80 % del tráfico de anuncios llega desde el celular, por eso la experiencia mobile es clave para las campañas.
- **Entregas:** los envíos mejoraron en 2025 (de 5,8 a 4,6 días), pero Córdoba sigue siendo la provincia más lenta.

### Ventas netas y clientes

- **Estados:** el 91,9 % de los pedidos se concreta. Cancelaciones y reembolsos suman $33,1 M que no se cobraron.
- **Impuestos:** de cada $100 vendidos, $17 son IVA. La venta neta es $317,3 M sobre $382,4 M brutos.
- **Clientes:** el 71 % vuelve a comprar y las recompras generan el 70 % de la facturación. El 20 % de clientes que más compra aporta el 47 %.


---

# Material de la cátedra

Lo que sigue es la guía original de la cátedra sobre los datos de origen y las tablas, que sirvió de base para este trabajo.

## Práctica — Introducción al Marketing Online y los Negocios Digitales

Este repositorio tiene los datos de **EcoBottle AR** para la práctica.

- **Consigna:** [Práctica](https://docs.google.com/document/d/15RNP3FVqLjO4jzh80AAkK6mUR5DOLqPxLjQxqvdzrYg/edit?usp=sharing)
- **Diagrama de las tablas de origen (DER):** [ver más abajo](#diagrama-de-las-tablas-de-origen-der)

### ¿Qué hay en el repositorio?

```
raw/               los datos de origen: un archivo CSV por tabla (en SQL: raw.<tabla>)
sql/               acá escribís tus transformaciones en SQL        ← tu trabajo va acá
run_sql.py         ejecuta tus archivos SQL y arma el data warehouse
requirements.txt   lo que hay que instalar (DuckDB)
dw/                el data warehouse: se crea solo al ejecutar run_sql.py
generator/         el programa que creó los datos de raw/ (no hace falta usarlo)
assets/            el diagrama de tablas de origen (DER)
```

> ⚠️ **No modifiques los archivos de `raw/`.** Son los datos de origen. Tus consultas SQL los leen y el resultado queda en `dw/`.

### Los datos en un minuto

- Son una **foto del sistema de ventas** de EcoBottle, tomada el **30/09/2025 a las 23:59:59**.
- Tienen los pedidos del **01/01/2024 al 30/09/2025**.
- Los montos están en **pesos argentinos**, y los precios de lista **no incluyen IVA**.
- Las fechas y horas están en **hora de Argentina**.
- Una **celda vacía** en un CSV significa que ese dato no existe. En SQL aparece como `NULL`.

### Las tablas

| Archivo | Qué guarda | Filas |
|---|---|---:|
| `channel.csv` | Los 2 canales de venta: `ONLINE` (web) y `OFFLINE` (tiendas) | 2 |
| `province.csv` | Las 4 provincias donde opera la empresa | 4 |
| `product_category.csv` | Categorías de producto: *Bottles* → *Classic* y *Sport* | 3 |
| `product.csv` | Los 2 productos: Classic A y Sport B | 2 |
| `store.csv` | Las 4 tiendas físicas | 4 |
| `customer.csv` | Los clientes | ~3.500 |
| `address.csv` | Las direcciones de clientes y tiendas | ~3.800 |
| `sales_order.csv` | Los pedidos: quién compró, cuándo, por qué canal y cuánto pagó | ~12.000 |
| `sales_order_item.csv` | Los productos de cada pedido (una fila por producto) | ~14.500 |
| `payment.csv` | El pago de cada pedido | ~12.000 |
| `shipment.csv` | Los envíos por correo | ~7.000 |
| `web_session.csv` | Las visitas a la web | ~100.000 |
| `nps_response.csv` | Las respuestas a la encuesta de satisfacción (NPS) | ~3.000 |

En SQL, cada archivo es una tabla del esquema `raw`: `raw/sales_order.csv` se consulta como `raw.sales_order`.

#### Diagrama de las tablas de origen (DER)

Cada caja es una tabla (un CSV de `raw/`) y cada línea une una clave foránea (FK) con la clave primaria (PK) a la que apunta.

![Diagrama entidad-relación de las tablas de origen](./assets/DER.png)

### Cómo leer los datos

#### Pedidos
- **Pedido online:** `store_id` está vacío.
- **Compra en tienda:** `store_id` indica la tienda, y la "dirección de envío" es la dirección de la tienda (el cliente se lleva el producto en el momento).
- **Las cuentas siempre cierran:**
  - `line_total` = cantidad × precio − descuento
  - `subtotal` = suma de los `line_total` del pedido
  - `tax_amount` = 21 % del subtotal (IVA)
  - `total_amount` = subtotal + IVA + costo de envío

#### Estados de un pedido (`sales_order.status`)

| Estado | Qué significa | ¿Cuenta como venta? |
|---|---|:---:|
| `CREATED` | Se hizo el pedido pero todavía no se pagó | No |
| `PAID` | Está pagado pero todavía no se entregó | Sí |
| `FULFILLED` | Ya se entregó (o se compró en la tienda) | Sí |
| `CANCELLED` | Se canceló: el pago fue rechazado, no se pagó a tiempo o el cliente se arrepintió | No |
| `REFUNDED` | Se entregó, pero después se devolvió el dinero | No |

#### Pagos y envíos
- Cada pedido tiene **un pago**. Si el pago no se concretó, `paid_at` está vacío.
- **Solo tienen envío** (`shipment`) los pedidos que viajan por correo: los online y algunos que la tienda manda a domicilio. Las compras en tienda no tienen envío.
- **Estados del envío:**
  - `READY`: se está preparando.
  - `SHIPPED`: está viajando.
  - `DELIVERED`: se entregó.
  - `CANCELLED`: no salió.

#### Clientes y visitas a la web
- Un cliente con `status = 'I'` dio de baja su cuenta. Sus compras anteriores siguen en los datos.
- En `web_session`, un `customer_id` vacío es un visitante que no inició sesión.
- **Origen de la visita** (`source`):
  - `ads`: publicidad en redes.
  - `direct`: entró directo o desde el newsletter.
  - `referral`: vino de otro sitio o del newsletter.
  - `organic`: buscadores.

#### Encuesta NPS
- **Cuándo se manda:**
  - Pedidos entregados por correo: **7 días después de la entrega**.
  - Compras en tienda: **al día siguiente**.
- El puntaje va de 0 a 10. Un `customer_id` vacío es una respuesta anónima.
- La encuesta **no tiene número de pedido**: se relaciona con el cliente (`customer_id`) y con el canal (`channel_id`).

### Para empezar

Vas a escribir las transformaciones en **SQL** usando **DuckDB**, una base de datos que se instala con Python. No necesita servidor ni crear cuentas.

#### 1. Preparar tu computadora (una sola vez)

Necesitás tener instalado Python 3.9 o más nuevo y Git. Primero hacé un **fork** de este repositorio en GitHub y después, en la terminal:

```bash
git clone URL-DE-TU-FORK
cd NOMBRE-DE-LA-CARPETA
python -m venv .venv
```

Activá el entorno virtual:

- **Mac / Linux:** `source .venv/bin/activate`
- **Windows:** `.venv\Scripts\activate`

Instalá DuckDB:

```bash
pip install -r requirements.txt
```

> En Mac, si el comando `python` no existe, usá `python3`. Cada vez que abras una terminal nueva, volvé a activar el entorno.

#### 2. Explorar las tablas de origen

```bash
python run_sql.py --explorar
```

Abre DuckDB en el navegador con las 13 tablas de origen cargadas. Hacé clic en una tabla para ver sus columnas y datos, y escribí consultas para conocerla:

```sql
SELECT * FROM raw.sales_order LIMIT 10;
DESCRIBE raw.sales_order;
```

- **No ejecuta tus archivos de `sql/`**, así que funciona aunque todavía no hayas escrito nada o tengas errores.
- **Necesita internet.** Sin conexión se abre una consola SQL en la terminal: terminás cada consulta con `;` y salís escribiendo `salir`.
- **Para cerrar,** volvé a la terminal y presioná Enter.

#### 3. Escribir tus transformaciones en SQL

| Archivo | Qué va adentro |
|---|---|
| `sql/01_dimensiones.sql` | Las tablas de dimensiones. Tiene un **ejemplo resuelto** (`dim_product`) para que veas cómo se hace. |
| `sql/02_hechos.sql` | Las tablas de hechos, con sus `FOREIGN KEY` hacia las dimensiones. |
| `sql/03_consultas.sql` | Consultas para revisar el modelo y calcular los KPIs. |

Cuando una consulta te funciona mientras explorás, pasala al archivo que corresponde. Podés agregar más archivos: se ejecutan en orden alfabético (`01_...`, `02_...`, `03_...`).

#### 4. Armar el data warehouse

```bash
python run_sql.py
```

Esto hace cuatro cosas:

1. Crea la base de datos `warehouse.duckdb` desde cero.
2. Ejecuta tus archivos de `sql/` en orden y muestra en la terminal el resultado de cada `SELECT`.
3. Guarda cada tabla que creaste como CSV en `dw/`. **Esos CSV son los que después abrís en Power BI.**
4. Dibuja tu modelo estrella en `dw/modelo_estrella.md`.

Si hay un error, te dice en qué archivo y en qué sentencia está y por qué falló. Lo corregís y volvés a ejecutar. Como todo se arma desde cero cada vez, no hace falta borrar tablas a mano.

> La base `warehouse.duckdb` no se sube a GitHub (está en `.gitignore`): cualquiera la vuelve a crear con `python run_sql.py`.

#### 5. Ver tu modelo

- **El diagrama:** abrí `dw/modelo_estrella.md` en GitHub y vas a ver el modelo dibujado, con las claves y las relaciones. Podés copiarlo en tu README. En VS Code se ve con la extensión *Markdown Preview Mermaid Support*.
- **Tus tablas en el navegador:** `python run_sql.py --ui` arma el data warehouse y después abre DuckDB con tus tablas y las de origen, para revisar resultados y armar gráficos rápidos.

#### Mini guía de SQL en DuckDB

```sql
-- Ver las primeras filas de una tabla de origen
SELECT * FROM raw.sales_order LIMIT 10;

-- Ver sus columnas y tipos
DESCRIBE raw.sales_order;

-- Agrupar por mes
SELECT DATE_TRUNC('month', order_date) AS mes, COUNT(*) AS pedidos
FROM raw.sales_order
GROUP BY mes
ORDER BY mes;
```

- **Datos vacíos:** se buscan con `IS NULL`, y `COALESCE(columna, valor)` reemplaza un vacío por un valor.
- **Más ayuda:** [documentación de SQL de DuckDB](https://duckdb.org/docs/current/sql/introduction.html).

### ¿Y la carpeta `generator/`?

Es el programa que **inventó estos datos** simulando el negocio: clientes que se registran, compran, pagan, reciben el envío y responden la encuesta. **No lo necesitás para la práctica.** Si te interesa ver cómo se arma un conjunto de datos de prueba, podés leerlo; el detalle está en [`generator/README.md`](./generator/README.md).

Si alguna vez querés volver a generar los datos o comprobar que están bien:

```bash
python generator/generate_raw.py     # vuelve a crear los CSV de raw/ (salen idénticos)
python generator/validate_raw.py     # revisa que los datos cumplan todas las reglas
```
