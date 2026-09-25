-- F1: sync offline-first + seed prodotti comuni.
-- rev = numero di revisione assegnato dal server (monotono). I client scaricano "tutto con rev > cursore",
-- cosi' un dispositivo rimasto offline non perde modifiche anche se gli orologi non sono allineati.

CREATE TABLE sync_meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
INSERT INTO sync_meta (k, v) VALUES ('rev', 0);

ALTER TABLE locations ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_locations_rev ON locations(rev);
ALTER TABLE categories ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_categories_rev ON categories(rev);
ALTER TABLE stores ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_stores_rev ON stores(rev);
ALTER TABLE products ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_products_rev ON products(rev);
ALTER TABLE receipts ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_receipts_rev ON receipts(rev);
ALTER TABLE purchase_lines ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_purchase_lines_rev ON purchase_lines(rev);
ALTER TABLE stock_lots ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_stock_lots_rev ON stock_lots(rev);
ALTER TABLE shopping_items ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_shopping_items_rev ON shopping_items(rev);
ALTER TABLE extra_expenses ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_extra_expenses_rev ON extra_expenses(rev);
ALTER TABLE budgets ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_budgets_rev ON budgets(rev);

ALTER TABLE shopping_items ADD COLUMN note TEXT;
ALTER TABLE stock_lots ADD COLUMN note TEXT;

-- Prodotti comuni (modificabili/eliminabili dall'app)
INSERT INTO products (id, name, area, category_id, default_unit, default_location_id, open_shelf_days, freezer_max_months, updated_at) VALUES
 ('p-spaghetti', 'Spaghetti', 'cibo', 'cat-pasta', 'g', 'loc-dispensa', NULL, NULL, 0),
 ('p-penne', 'Penne', 'cibo', 'cat-pasta', 'g', 'loc-dispensa', NULL, NULL, 0),
 ('p-fusilli', 'Fusilli', 'cibo', 'cat-pasta', 'g', 'loc-dispensa', NULL, NULL, 0),
 ('p-pasta-all-uovo', 'Pasta all''uovo', 'cibo', 'cat-pasta', 'g', 'loc-dispensa', NULL, NULL, 0),
 ('p-riso-carnaroli', 'Riso Carnaroli', 'cibo', 'cat-pasta', 'g', 'loc-dispensa', NULL, NULL, 0),
 ('p-riso-basmati', 'Riso basmati', 'cibo', 'cat-pasta', 'g', 'loc-dispensa', NULL, NULL, 0),
 ('p-gnocchi', 'Gnocchi', 'cibo', 'cat-pasta', 'conf', 'loc-frigo', NULL, 3, 0),
 ('p-pane', 'Pane', 'cibo', 'cat-pane', 'pz', 'loc-dispensa', 3, 3, 0),
 ('p-pancarre', 'Pancarrè', 'cibo', 'cat-pane', 'conf', 'loc-dispensa', 5, 3, 0),
 ('p-farina-00', 'Farina 00', 'cibo', 'cat-pane', 'kg', 'loc-dispensa', NULL, NULL, 0),
 ('p-pangrattato', 'Pangrattato', 'cibo', 'cat-pane', 'conf', 'loc-dispensa', NULL, NULL, 0),
 ('p-grissini', 'Grissini', 'cibo', 'cat-pane', 'conf', 'loc-dispensa', 30, NULL, 0),
 ('p-fette-biscottate', 'Fette biscottate', 'cibo', 'cat-pane', 'conf', 'loc-dispensa', 30, NULL, 0),
 ('p-cereali-colazione', 'Cereali colazione', 'cibo', 'cat-pane', 'conf', 'loc-dispensa', 60, NULL, 0),
 ('p-latte', 'Latte', 'cibo', 'cat-latte', 'l', 'loc-frigo', 3, NULL, 0),
 ('p-latte-uht', 'Latte UHT', 'cibo', 'cat-latte', 'l', 'loc-dispensa', 4, NULL, 0),
 ('p-yogurt-bianco', 'Yogurt bianco', 'cibo', 'cat-latte', 'pz', 'loc-frigo', NULL, NULL, 0),
 ('p-burro', 'Burro', 'cibo', 'cat-latte', 'g', 'loc-frigo', 30, 6, 0),
 ('p-panna-da-cucina', 'Panna da cucina', 'cibo', 'cat-latte', 'pz', 'loc-frigo', 3, NULL, 0),
 ('p-mozzarella', 'Mozzarella', 'cibo', 'cat-formaggi', 'pz', 'loc-frigo', 2, NULL, 0),
 ('p-parmigiano-reggiano', 'Parmigiano Reggiano', 'cibo', 'cat-formaggi', 'g', 'loc-frigo', 30, NULL, 0),
 ('p-grana-padano', 'Grana Padano', 'cibo', 'cat-formaggi', 'g', 'loc-frigo', 30, NULL, 0),
 ('p-ricotta', 'Ricotta', 'cibo', 'cat-formaggi', 'g', 'loc-frigo', 3, NULL, 0),
 ('p-stracchino', 'Stracchino', 'cibo', 'cat-formaggi', 'g', 'loc-frigo', 3, NULL, 0),
 ('p-scamorza', 'Scamorza', 'cibo', 'cat-formaggi', 'g', 'loc-frigo', 7, NULL, 0),
 ('p-mascarpone', 'Mascarpone', 'cibo', 'cat-formaggi', 'g', 'loc-frigo', 3, NULL, 0),
 ('p-petto-di-pollo', 'Petto di pollo', 'cibo', 'cat-carne', 'g', 'loc-frigo', 1, 6, 0),
 ('p-carne-macinata', 'Carne macinata', 'cibo', 'cat-carne', 'g', 'loc-frigo', 1, 3, 0),
 ('p-fettine-di-vitello', 'Fettine di vitello', 'cibo', 'cat-carne', 'g', 'loc-frigo', 1, 6, 0),
 ('p-salsiccia', 'Salsiccia', 'cibo', 'cat-carne', 'g', 'loc-frigo', 1, 3, 0),
 ('p-hamburger', 'Hamburger', 'cibo', 'cat-carne', 'pz', 'loc-frigo', 1, 4, 0),
 ('p-salmone', 'Salmone', 'cibo', 'cat-pesce', 'g', 'loc-frigo', 1, 3, 0),
 ('p-tonno-in-scatola', 'Tonno in scatola', 'cibo', 'cat-conserve', 'pz', 'loc-dispensa', 2, NULL, 0),
 ('p-merluzzo', 'Merluzzo', 'cibo', 'cat-pesce', 'g', 'loc-freezer', NULL, 6, 0),
 ('p-gamberi', 'Gamberi', 'cibo', 'cat-pesce', 'g', 'loc-freezer', NULL, 6, 0),
 ('p-prosciutto-crudo', 'Prosciutto crudo', 'cibo', 'cat-salumi', 'g', 'loc-frigo', 3, NULL, 0),
 ('p-prosciutto-cotto', 'Prosciutto cotto', 'cibo', 'cat-salumi', 'g', 'loc-frigo', 3, NULL, 0),
 ('p-bresaola', 'Bresaola', 'cibo', 'cat-salumi', 'g', 'loc-frigo', 3, NULL, 0),
 ('p-salame', 'Salame', 'cibo', 'cat-salumi', 'g', 'loc-frigo', 10, NULL, 0),
 ('p-speck', 'Speck', 'cibo', 'cat-salumi', 'g', 'loc-frigo', 5, NULL, 0),
 ('p-uova', 'Uova', 'cibo', 'cat-uova', 'pz', 'loc-frigo', NULL, NULL, 0),
 ('p-mele', 'Mele', 'cibo', 'cat-frutta', 'pz', 'loc-dispensa', NULL, NULL, 0),
 ('p-banane', 'Banane', 'cibo', 'cat-frutta', 'pz', 'loc-dispensa', NULL, NULL, 0),
 ('p-arance', 'Arance', 'cibo', 'cat-frutta', 'pz', 'loc-dispensa', NULL, NULL, 0),
 ('p-limoni', 'Limoni', 'cibo', 'cat-frutta', 'pz', 'loc-frigo', NULL, NULL, 0),
 ('p-frutti-di-bosco', 'Frutti di bosco', 'cibo', 'cat-frutta', 'conf', 'loc-frigo', 2, 8, 0),
 ('p-pomodori', 'Pomodori', 'cibo', 'cat-verdura', 'pz', 'loc-dispensa', NULL, NULL, 0),
 ('p-insalata', 'Insalata', 'cibo', 'cat-verdura', 'conf', 'loc-frigo', 2, NULL, 0),
 ('p-zucchine', 'Zucchine', 'cibo', 'cat-verdura', 'pz', 'loc-frigo', NULL, 8, 0),
 ('p-carote', 'Carote', 'cibo', 'cat-verdura', 'pz', 'loc-frigo', NULL, 8, 0),
 ('p-cipolle', 'Cipolle', 'cibo', 'cat-verdura', 'pz', 'loc-dispensa', NULL, NULL, 0),
 ('p-aglio', 'Aglio', 'cibo', 'cat-verdura', 'pz', 'loc-dispensa', NULL, NULL, 0),
 ('p-patate', 'Patate', 'cibo', 'cat-verdura', 'kg', 'loc-dispensa', NULL, NULL, 0),
 ('p-peperoni', 'Peperoni', 'cibo', 'cat-verdura', 'pz', 'loc-frigo', NULL, 8, 0),
 ('p-melanzane', 'Melanzane', 'cibo', 'cat-verdura', 'pz', 'loc-frigo', NULL, 8, 0),
 ('p-spinaci', 'Spinaci', 'cibo', 'cat-verdura', 'g', 'loc-frigo', 2, 8, 0),
 ('p-basilico', 'Basilico', 'cibo', 'cat-verdura', 'pz', 'loc-frigo', NULL, NULL, 0),
 ('p-prezzemolo', 'Prezzemolo', 'cibo', 'cat-verdura', 'pz', 'loc-frigo', NULL, NULL, 0),
 ('p-piselli-surgelati', 'Piselli surgelati', 'cibo', 'cat-surgelati', 'g', 'loc-freezer', NULL, 12, 0),
 ('p-minestrone-surgelato', 'Minestrone surgelato', 'cibo', 'cat-surgelati', 'g', 'loc-freezer', NULL, 12, 0),
 ('p-pizza-surgelata', 'Pizza surgelata', 'cibo', 'cat-surgelati', 'pz', 'loc-freezer', NULL, 6, 0),
 ('p-passata-di-pomodoro', 'Passata di pomodoro', 'cibo', 'cat-conserve', 'pz', 'loc-dispensa', 4, NULL, 0),
 ('p-pelati', 'Pelati', 'cibo', 'cat-conserve', 'pz', 'loc-dispensa', 4, NULL, 0),
 ('p-concentrato-di-pomodoro', 'Concentrato di pomodoro', 'cibo', 'cat-conserve', 'pz', 'loc-dispensa', 7, NULL, 0),
 ('p-ceci-in-scatola', 'Ceci in scatola', 'cibo', 'cat-conserve', 'pz', 'loc-dispensa', 3, NULL, 0),
 ('p-fagioli-in-scatola', 'Fagioli in scatola', 'cibo', 'cat-conserve', 'pz', 'loc-dispensa', 3, NULL, 0),
 ('p-lenticchie-secche', 'Lenticchie secche', 'cibo', 'cat-conserve', 'g', 'loc-dispensa', NULL, NULL, 0),
 ('p-pesto', 'Pesto', 'cibo', 'cat-conserve', 'pz', 'loc-frigo', 5, NULL, 0),
 ('p-olive', 'Olive', 'cibo', 'cat-conserve', 'pz', 'loc-dispensa', 14, NULL, 0),
 ('p-brodo-dado', 'Brodo (dado)', 'cibo', 'cat-conserve', 'conf', 'loc-dispensa', NULL, NULL, 0),
 ('p-olio-extravergine', 'Olio extravergine', 'cibo', 'cat-condimenti', 'l', 'loc-dispensa', NULL, NULL, 0),
 ('p-olio-di-semi', 'Olio di semi', 'cibo', 'cat-condimenti', 'l', 'loc-dispensa', NULL, NULL, 0),
 ('p-aceto-balsamico', 'Aceto balsamico', 'cibo', 'cat-condimenti', 'pz', 'loc-dispensa', NULL, NULL, 0),
 ('p-aceto-di-vino', 'Aceto di vino', 'cibo', 'cat-condimenti', 'pz', 'loc-dispensa', NULL, NULL, 0),
 ('p-maionese', 'Maionese', 'cibo', 'cat-condimenti', 'pz', 'loc-frigo', 60, NULL, 0),
 ('p-ketchup', 'Ketchup', 'cibo', 'cat-condimenti', 'pz', 'loc-frigo', 60, NULL, 0),
 ('p-senape', 'Senape', 'cibo', 'cat-condimenti', 'pz', 'loc-frigo', 60, NULL, 0),
 ('p-sale-fino', 'Sale fino', 'cibo', 'cat-spezie', 'kg', 'loc-dispensa', NULL, NULL, 0),
 ('p-sale-grosso', 'Sale grosso', 'cibo', 'cat-spezie', 'kg', 'loc-dispensa', NULL, NULL, 0),
 ('p-pepe-nero', 'Pepe nero', 'cibo', 'cat-spezie', 'pz', 'loc-dispensa', NULL, NULL, 0),
 ('p-origano', 'Origano', 'cibo', 'cat-spezie', 'pz', 'loc-dispensa', NULL, NULL, 0),
 ('p-peperoncino', 'Peperoncino', 'cibo', 'cat-spezie', 'pz', 'loc-dispensa', NULL, NULL, 0),
 ('p-zucchero', 'Zucchero', 'cibo', 'cat-colazione', 'kg', 'loc-dispensa', NULL, NULL, 0),
 ('p-biscotti', 'Biscotti', 'cibo', 'cat-colazione', 'conf', 'loc-dispensa', 15, NULL, 0),
 ('p-marmellata', 'Marmellata', 'cibo', 'cat-colazione', 'pz', 'loc-frigo', 30, NULL, 0),
 ('p-nutella', 'Nutella', 'cibo', 'cat-colazione', 'pz', 'loc-dispensa', NULL, NULL, 0),
 ('p-miele', 'Miele', 'cibo', 'cat-colazione', 'pz', 'loc-dispensa', NULL, NULL, 0),
 ('p-cioccolato-fondente', 'Cioccolato fondente', 'cibo', 'cat-colazione', 'pz', 'loc-dispensa', NULL, NULL, 0),
 ('p-lievito-per-dolci', 'Lievito per dolci', 'cibo', 'cat-colazione', 'pz', 'loc-dispensa', NULL, NULL, 0),
 ('p-caffe-macinato', 'Caffè macinato', 'cibo', 'cat-caffe', 'g', 'loc-dispensa', 15, NULL, 0),
 ('p-capsule-caffe', 'Capsule caffè', 'cibo', 'cat-caffe', 'conf', 'loc-dispensa', NULL, NULL, 0),
 ('p-te', 'Tè', 'cibo', 'cat-caffe', 'conf', 'loc-dispensa', NULL, NULL, 0),
 ('p-camomilla', 'Camomilla', 'cibo', 'cat-caffe', 'conf', 'loc-dispensa', NULL, NULL, 0),
 ('p-acqua-naturale', 'Acqua naturale', 'cibo', 'cat-bevande', 'l', 'loc-dispensa', NULL, NULL, 0),
 ('p-acqua-frizzante', 'Acqua frizzante', 'cibo', 'cat-bevande', 'l', 'loc-dispensa', NULL, NULL, 0),
 ('p-birra', 'Birra', 'cibo', 'cat-bevande', 'pz', 'loc-dispensa', NULL, NULL, 0),
 ('p-vino-rosso', 'Vino rosso', 'cibo', 'cat-bevande', 'pz', 'loc-dispensa', 3, NULL, 0),
 ('p-vino-bianco', 'Vino bianco', 'cibo', 'cat-bevande', 'pz', 'loc-frigo', 3, NULL, 0),
 ('p-succo-di-frutta', 'Succo di frutta', 'cibo', 'cat-bevande', 'l', 'loc-dispensa', 4, NULL, 0),
 ('p-detersivo-piatti', 'Detersivo piatti', 'casa', 'cat-pulizia', 'pz', 'loc-soggiorno', NULL, NULL, 0),
 ('p-pastiglie-lavastoviglie', 'Pastiglie lavastoviglie', 'casa', 'cat-pulizia', 'conf', 'loc-soggiorno', NULL, NULL, 0),
 ('p-sgrassatore', 'Sgrassatore', 'casa', 'cat-pulizia', 'pz', 'loc-soggiorno', NULL, NULL, 0),
 ('p-candeggina', 'Candeggina', 'casa', 'cat-pulizia', 'pz', 'loc-bagno', NULL, NULL, 0),
 ('p-anticalcare', 'Anticalcare', 'casa', 'cat-pulizia', 'pz', 'loc-bagno', NULL, NULL, 0),
 ('p-detergente-pavimenti', 'Detergente pavimenti', 'casa', 'cat-pulizia', 'pz', 'loc-soggiorno', NULL, NULL, 0),
 ('p-spugne', 'Spugne', 'casa', 'cat-pulizia', 'conf', 'loc-soggiorno', NULL, NULL, 0),
 ('p-detersivo-lavatrice', 'Detersivo lavatrice', 'casa', 'cat-lavanderia', 'pz', 'loc-bagno', NULL, NULL, 0),
 ('p-ammorbidente', 'Ammorbidente', 'casa', 'cat-lavanderia', 'pz', 'loc-bagno', NULL, NULL, 0),
 ('p-carta-igienica', 'Carta igienica', 'casa', 'cat-carta', 'conf', 'loc-bagno', NULL, NULL, 0),
 ('p-carta-cucina', 'Carta cucina', 'casa', 'cat-carta', 'conf', 'loc-soggiorno', NULL, NULL, 0),
 ('p-fazzoletti', 'Fazzoletti', 'casa', 'cat-carta', 'conf', 'loc-soggiorno', NULL, NULL, 0),
 ('p-tovaglioli', 'Tovaglioli', 'casa', 'cat-carta', 'conf', 'loc-soggiorno', NULL, NULL, 0),
 ('p-shampoo', 'Shampoo', 'casa', 'cat-igiene', 'pz', 'loc-bagno', NULL, NULL, 0),
 ('p-bagnoschiuma', 'Bagnoschiuma', 'casa', 'cat-igiene', 'pz', 'loc-bagno', NULL, NULL, 0),
 ('p-sapone-mani', 'Sapone mani', 'casa', 'cat-igiene', 'pz', 'loc-bagno', NULL, NULL, 0),
 ('p-dentifricio', 'Dentifricio', 'casa', 'cat-igiene', 'pz', 'loc-bagno', NULL, NULL, 0),
 ('p-spazzolino', 'Spazzolino', 'casa', 'cat-igiene', 'pz', 'loc-bagno', NULL, NULL, 0),
 ('p-deodorante', 'Deodorante', 'casa', 'cat-igiene', 'pz', 'loc-bagno', NULL, NULL, 0),
 ('p-rasoi', 'Rasoi', 'casa', 'cat-igiene', 'conf', 'loc-bagno', NULL, NULL, 0),
 ('p-pellicola', 'Pellicola', 'casa', 'cat-cucina', 'pz', 'loc-soggiorno', NULL, NULL, 0),
 ('p-alluminio', 'Alluminio', 'casa', 'cat-cucina', 'pz', 'loc-soggiorno', NULL, NULL, 0),
 ('p-sacchetti-gelo', 'Sacchetti gelo', 'casa', 'cat-cucina', 'conf', 'loc-soggiorno', NULL, NULL, 0),
 ('p-carta-forno', 'Carta forno', 'casa', 'cat-cucina', 'pz', 'loc-soggiorno', NULL, NULL, 0),
 ('p-sacchi-indifferenziata', 'Sacchi indifferenziata', 'casa', 'cat-spazzatura', 'conf', 'loc-soggiorno', NULL, NULL, 0),
 ('p-sacchi-umido', 'Sacchi umido', 'casa', 'cat-spazzatura', 'conf', 'loc-soggiorno', NULL, NULL, 0),
 ('p-sacchi-plastica', 'Sacchi plastica', 'casa', 'cat-spazzatura', 'conf', 'loc-soggiorno', NULL, NULL, 0),
 ('p-pile-aa', 'Pile AA', 'casa', 'cat-manutenz', 'conf', 'loc-altro', NULL, NULL, 0),
 ('p-pile-aaa', 'Pile AAA', 'casa', 'cat-manutenz', 'conf', 'loc-altro', NULL, NULL, 0),
 ('p-lampadine', 'Lampadine', 'casa', 'cat-manutenz', 'pz', 'loc-altro', NULL, NULL, 0),
 ('p-paracetamolo', 'Paracetamolo', 'casa', 'cat-farmacia', 'conf', 'loc-farmacia', NULL, NULL, 0),
 ('p-ibuprofene', 'Ibuprofene', 'casa', 'cat-farmacia', 'conf', 'loc-farmacia', NULL, NULL, 0),
 ('p-cerotti', 'Cerotti', 'casa', 'cat-farmacia', 'conf', 'loc-farmacia', NULL, NULL, 0),
 ('p-disinfettante', 'Disinfettante', 'casa', 'cat-farmacia', 'pz', 'loc-farmacia', NULL, NULL, 0),
 ('p-termometro', 'Termometro', 'casa', 'cat-farmacia', 'pz', 'loc-farmacia', NULL, NULL, 0);
