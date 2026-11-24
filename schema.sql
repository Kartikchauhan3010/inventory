-- Smart Inventory & Warehouse Management System (PostgreSQL) - corrected schema
DROP TABLE IF EXISTS stock_movements, sales_order_items, sales_orders, purchase_order_items,
  purchase_orders, inventory, products, warehouses, suppliers, categories CASCADE;

CREATE TABLE categories (
  category_id SERIAL PRIMARY KEY,
  category_name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT);

CREATE TABLE suppliers (
  supplier_id SERIAL PRIMARY KEY,
  supplier_name VARCHAR(150) NOT NULL,
  contact_email VARCHAR(100) UNIQUE NOT NULL,
  phone VARCHAR(20),
  address TEXT);

CREATE TABLE warehouses (
  warehouse_id SERIAL PRIMARY KEY,
  warehouse_name VARCHAR(100) NOT NULL UNIQUE,
  location VARCHAR(200) NOT NULL,
  capacity INT NOT NULL CHECK (capacity > 0));

-- FIX: category_id is NOT NULL so every product is categorised
CREATE TABLE products (
  product_id SERIAL PRIMARY KEY,
  sku VARCHAR(50) UNIQUE NOT NULL,
  product_name VARCHAR(150) NOT NULL,
  category_id INT NOT NULL REFERENCES categories(category_id) ON DELETE RESTRICT,
  unit_price DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0),
  reorder_level INT NOT NULL DEFAULT 10 CHECK (reorder_level >= 0));

CREATE TABLE inventory (
  inventory_id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  warehouse_id INT NOT NULL REFERENCES warehouses(warehouse_id) ON DELETE CASCADE,
  quantity_on_hand INT NOT NULL CHECK (quantity_on_hand >= 0),
  last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_product_warehouse UNIQUE (product_id, warehouse_id));

-- FIX: purchase tables were in the ER design but missing from the DDL
CREATE TABLE purchase_orders (
  po_id SERIAL PRIMARY KEY,
  supplier_id INT NOT NULL REFERENCES suppliers(supplier_id),
  order_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RECEIVED','CANCELLED')));

CREATE TABLE purchase_order_items (
  po_item_id SERIAL PRIMARY KEY,
  po_id INT NOT NULL REFERENCES purchase_orders(po_id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(product_id),
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_cost DECIMAL(10,2) NOT NULL CHECK (unit_cost >= 0));

CREATE TABLE sales_orders (
  sale_id SERIAL PRIMARY KEY,
  sale_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  customer_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED','CANCELLED')));

-- unit_price is a deliberate price SNAPSHOT at sale time (not a 3NF violation:
-- it is history, and products.unit_price may change later).
CREATE TABLE sales_order_items (
  sale_item_id SERIAL PRIMARY KEY,
  sale_id INT NOT NULL REFERENCES sales_orders(sale_id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(product_id),
  warehouse_id INT NOT NULL REFERENCES warehouses(warehouse_id),
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0));

-- FIX: CHECK ties movement_type to which warehouses must / must not be set
CREATE TABLE stock_movements (
  movement_id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(product_id),
  source_warehouse_id INT REFERENCES warehouses(warehouse_id),
  target_warehouse_id INT REFERENCES warehouses(warehouse_id),
  movement_type VARCHAR(20) NOT NULL CHECK (movement_type IN ('INBOUND','OUTBOUND','TRANSFER')),
  quantity INT NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_movement_warehouses CHECK (
    (movement_type='INBOUND'  AND source_warehouse_id IS NULL AND target_warehouse_id IS NOT NULL) OR
    (movement_type='OUTBOUND' AND source_warehouse_id IS NOT NULL AND target_warehouse_id IS NULL) OR
    (movement_type='TRANSFER' AND source_warehouse_id IS NOT NULL AND target_warehouse_id IS NOT NULL
                              AND source_warehouse_id <> target_warehouse_id)));

-- FIX: no idx on inventory(product_id, warehouse_id): UNIQUE already creates it.
CREATE INDEX idx_inventory_warehouse ON inventory(warehouse_id);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_sales_items_product ON sales_order_items(product_id);
CREATE INDEX idx_sales_items_sale ON sales_order_items(sale_id);
CREATE INDEX idx_po_items_po ON purchase_order_items(po_id);
CREATE INDEX idx_stock_movements_analysis ON stock_movements(product_id, movement_type, created_at);
CREATE INDEX idx_sales_orders_date ON sales_orders(sale_date);

-- Sample data
INSERT INTO categories(category_name,description) VALUES ('Electronics','Gadgets and accessories'),('Stationery','Office supplies'),('Grocery','Packaged food');
INSERT INTO suppliers(supplier_name,contact_email,phone) VALUES ('Delhi Wholesale Traders','sales@dwt.example','9800000001'),('Haryana Supplies Co','orders@hsc.example','9800000002');
INSERT INTO warehouses(warehouse_name,location,capacity) VALUES ('Gurugram Main','Gurugram, Haryana',5000),('Sohna Depot','Sohna, Haryana',2000);
INSERT INTO products(sku,product_name,category_id,unit_price,reorder_level) VALUES
 ('EL-001','USB-C Cable',1,199,50),('EL-002','Wireless Mouse',1,499,20),('ST-001','A4 Paper Ream',2,320,30),('GR-001','Basmati Rice 5kg',3,650,25);
INSERT INTO inventory(product_id,warehouse_id,quantity_on_hand) VALUES (1,1,120),(2,1,15),(3,1,80),(3,2,10),(4,2,40);
INSERT INTO stock_movements(product_id,source_warehouse_id,target_warehouse_id,movement_type,quantity) VALUES
 (1,NULL,1,'INBOUND',150),(1,1,NULL,'OUTBOUND',30),(2,NULL,1,'INBOUND',40),(2,1,NULL,'OUTBOUND',25),(3,1,2,'TRANSFER',10);
