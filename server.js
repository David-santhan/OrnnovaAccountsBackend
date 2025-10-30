const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const app = express();
const port = 7760;
const cron = require("node-cron");
const axios = require("axios")



// CORS middleware
app.use(cors({ origin: "http://localhost:3000", credentials: true }));
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads"))); // serve uploaded files

// Ensure uploads folder exists
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });


// SQLite DB

const db = new sqlite3.Database("./Accounting.db", (err) => {
  if (err) return console.error(err.message);
  console.log("Connected to SQLite database.");

  db.run("PRAGMA journal_mode=WAL;");      // enable WAL
  db.configure("busyTimeout", 5000);       // wait 5 seconds if busy
});


db.run(`
CREATE TABLE IF NOT EXISTS ClientsTable (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clientName TEXT,
  aboutClient TEXT,
  paymentTerms INTEGER,
  location TEXT,
  contactSpoc TEXT,
  contactEmail TEXT,
  contactNumber TEXT,
  gstApplicable TEXT,
  gstNumber TEXT,
  gstPercentage REAL
)
`);

db.run(
  `CREATE TABLE IF NOT EXISTS Projects (
  projectID TEXT PRIMARY KEY,
  clientID INTEGER NOT NULL,
  startDate TEXT,
  endDate TEXT,
  projectName TEXT,
  projectDescription TEXT,
  skill TEXT,
  projectLocation TEXT,
  spoc TEXT,
  mailID TEXT,
  mobileNo TEXT,
  billingType TEXT,
  billRate REAL,
  monthlyBilling REAL,
  employeeID TEXT,
  employeeName TEXT,
  poNumber TEXT,
  purchaseOrder TEXT,
  purchaseOrderValue REAL,
  active TEXT CHECK(active IN ('Yes','No')),
  invoiceCycle TEXT CHECK(invoiceCycle IN ('Monthly', 'Quarterly')),
  FOREIGN KEY (clientID) REFERENCES Clients(id) ON DELETE CASCADE
);
`
)
// db.run(`DROP TABLE IF EXISTS monthly_salary_payments;`);
// Create employees table if not exists
db.run(`
CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT NOT NULL,
    employee_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone_number INTEGER,
    skills TEXT,
    resume TEXT,
    photo TEXT,
    ctc TEXT,
    salary_paid TEXT CHECK(salary_paid IN ('Yes','No')),
    billable TEXT CHECK(billable IN ('Yes','No')),
    consultant_regular TEXT CHECK(consultant_regular IN ('Consultant','Regular')),
    active TEXT CHECK(active IN ('Yes','No')),
    project_ending TEXT CHECK(project_ending IN ('Yes','No')),
    date_of_joining TEXT DEFAULT (date('now'))
);
`);


// -- Salary tracking table with deductions and net take-home
db.run(
`CREATE TABLE IF NOT EXISTS salary_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT NOT NULL,
    employee_name TEXT,
    month TEXT NOT NULL,
    paid TEXT CHECK(paid IN ('Yes','No')) DEFAULT 'No',
    paid_date TEXT,
    
    -- Monthly Salary Components
    basic_pay REAL DEFAULT 0,
    hra REAL DEFAULT 0,
    conveyance_allowance REAL DEFAULT 0,
    medical_allowance REAL DEFAULT 0,
    lta REAL DEFAULT 0,
    personal_allowance REAL DEFAULT 0,
    gross_salary REAL DEFAULT 0,
    ctc REAL DEFAULT 0,
    
    -- Deductions (Employee)
    professional_tax REAL DEFAULT 0,
    insurance REAL DEFAULT 0,
    pf REAL DEFAULT 0,
    tds REAL DEFAULT 0,
    
    -- Deductions (Employer)
    employer_pf REAL DEFAULT 0,
    employer_health_insurance REAL DEFAULT 0,
    
    -- Final
    net_takehome REAL DEFAULT 0,

    FOREIGN KEY(employee_id) REFERENCES employees(employee_id)
);
`
)
// -- Forecast periods (master table)
db.run(
  `CREATE TABLE IF NOT EXISTS forecasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,                    -- e.g., "Q1 Forecast", "Sept 2025"
    start_date TEXT NOT NULL,              -- YYYY-MM-DD
    end_date TEXT NOT NULL                 -- YYYY-MM-DD
);`
);

// -- Transactions linked to forecasts
db.run(
  `CREATE TABLE IF NOT EXISTS forecast_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    forecast_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT CHECK(type IN ('Income','Expense')) NOT NULL,
    amount REAL NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT,
    category TEXT,
    FOREIGN KEY(forecast_id) REFERENCES forecasts(id)
);`
)

// Invoices Table
db.run(
  `CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT NOT NULL UNIQUE,
    invoice_date TEXT NOT NULL,        -- YYYY-MM-DD
    client_name TEXT NOT NULL,
    project_id TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    invoice_cycle TEXT CHECK(invoice_cycle IN ('Monthly', 'Quarterly')) NOT NULL,
    invoice_value REAL NOT NULL,
    gst_amount REAL NOT NULL,
    due_date TEXT NOT NULL,
    billable_days INTEGER NOT NULL,
    received TEXT CHECK(received IN ('Yes','No')) DEFAULT 'No',
    received_date TEXT
);
`
)

// Monthly Salary Payments Table
db.run(`
CREATE TABLE IF NOT EXISTS monthly_salary_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT NOT NULL,
    employee_name TEXT NOT NULL,
    paid TEXT CHECK(paid IN ('Yes','No')) NOT NULL DEFAULT 'No',
    month TEXT NOT NULL,               -- Format: YYYY-MM
    lop REAL DEFAULT 0,                -- Loss of Pay
    paid_amount REAL DEFAULT 0,        -- Amount already paid
    actual_to_pay REAL DEFAULT 0,      -- Net salary to pay after deductions
    paid_date TEXT DEFAULT (date('now')), -- Default today's date (YYYY-MM-DD)

    FOREIGN KEY(employee_id) 
        REFERENCES salary_payments(employee_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);
`);

// Expenses DB
db.run(`
  CREATE TABLE IF NOT EXISTS expenses (
    auto_id INTEGER PRIMARY KEY AUTOINCREMENT,
    regular TEXT CHECK(regular IN ('Yes','No')),
    type TEXT NOT NULL,
    description TEXT,
    amount REAL NOT NULL, -- base/expected amount
    currency TEXT DEFAULT 'INR',
    raised_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    paid_date TEXT,
    paid_amount REAL,
    status TEXT DEFAULT 'Raised'
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS expense_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_id INTEGER NOT NULL,
    month_year TEXT NOT NULL,
    actual_amount REAL NOT NULL,
    paid_amount REAL,
    paid_date TEXT,
    status TEXT DEFAULT 'Pending' CHECK(status IN ('Pending','Paid','Raised','In Process','Hold','Rejected')),
    remarks TEXT,
    FOREIGN KEY (expense_id) REFERENCES expenses(auto_id),
    UNIQUE(expense_id, month_year)
  );
`);


// GET clients
app.get("/getclients", (req, res) => {
  db.all("SELECT * FROM ClientsTable", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// POST add client
app.post("/addclients", (req, res) => {
  console.log(req.body);
  const {
    clientName,
    aboutClient,
    paymentTerms,
    location,
    contactSpoc,
    contactEmail,
    contactNumber,
    gstApplicable,
    gstNumber,
    gstPercentage,
  } = req.body;

  // const query = `
  //   INSERT INTO Clients
  //   (clientName, aboutClient, paymentTerms, location, contactSpoc, contactEmail, contactNumber, gstApplicable, gstNumber, gstPercentage)
  //   VALUES ( ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  // `;

db.serialize(() => {
  db.run(
    `INSERT INTO ClientsTable 
      ( clientName, aboutClient, paymentTerms, location, contactSpoc, contactEmail, contactNumber, gstApplicable, gstNumber, gstPercentage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      clientName,
      aboutClient,
      paymentTerms,
      location,
      contactSpoc,
      contactEmail,
      contactNumber,
      gstApplicable,
      gstNumber,
      gstPercentage,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    }
  );
});

});


// -------- ADD PROJECT API --------
function generateRandomNumber(length = 6) {
  return Math.floor(Math.random() * Math.pow(10, length))
    .toString()
    .padStart(length, "0");
}

function getUniqueProjectID(db, clientID, projectName, callback) {
  const prefix = `${clientID}${projectName.substring(0, 3).toUpperCase()}`;
  const tryID = `${prefix}${generateRandomNumber(6)}`;

  db.get("SELECT projectID FROM Projects WHERE projectID = ?", [tryID], (err, row) => {
    if (err) return callback(err, null);
    if (row) {
      // If ID exists, try again
      getUniqueProjectID(db, clientID, projectName, callback);
    } else {
      callback(null, tryID);
    }
  });
}

app.post("/addproject", upload.single("purchaseOrder"), (req, res) => {
  const {
    clientID,
    startDate,
    endDate,
    projectName,
    projectDescription,
    skill,
    projectLocation,
    spoc,
    mailID,
    mobileNo,
    billingType,
    billRate,
    monthlyBilling,
    employeeID,
    employeeName,
    poNumber,
    purchaseOrderValue,
    active,
    invoiceCycle,
  } = req.body;

  const purchaseOrderFile = req.file ? req.file.filename : null;

  // Generate unique projectID
  getUniqueProjectID(db, clientID, projectName, (err, uniqueID) => {
    if (err) {
      console.error("Error generating projectID:", err);
      return res.status(500).json({ error: "Failed to generate project ID" });
    }

    const query = `
      INSERT INTO Projects
      (projectID, clientID, startDate, endDate, projectName, projectDescription, skill, projectLocation, spoc, mailID, mobileNo, billingType, billRate, monthlyBilling, employeeID, employeeName, poNumber, purchaseOrder, purchaseOrderValue, active, invoiceCycle)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(
      query,
      [
        uniqueID,
        clientID,
        startDate,
        endDate,
        projectName,
        projectDescription,
        skill,
        projectLocation,
        spoc,
        mailID,
        mobileNo,
        billingType,
        billRate,
        monthlyBilling,
        employeeID,
        employeeName,
        poNumber,
        purchaseOrderFile,
        purchaseOrderValue,
        active,
        invoiceCycle,
      ],
      function (err) {
        if (err) {
          console.error("DB Error:", err.message);
          return res.status(500).json({ error: err.message });
        }
        res.json({ projectID: uniqueID, message: "Project added successfully" });
      }
    );
  });
});

// -------- GET PROJECTS API --------
app.get("/getprojects", (req, res) => {
  db.all("SELECT * FROM Projects", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// POST API (add new employee)
app.post(
  "/postemployees",
  upload.fields([{ name: "resume" }, { name: "photo" }]),
  (req, res) => {
    const {
      employee_id,
      employee_name,
      email,
      phone_number,
      skills,
      ctc,
      billable,
      consultant_regular,
      active,
      project_ending,
      date_of_joining
    } = req.body;

    const resume = req.files["resume"] ? req.files["resume"][0].path : null;
    const photo = req.files["photo"] ? req.files["photo"][0].path : null;

   db.run(
  `INSERT INTO employees 
  (employee_id, employee_name, email, phone_number, skills, ctc, resume, photo, salary_paid, billable, consultant_regular, active, project_ending,date_of_joining) 
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?)`,
  [
    employee_id,
    employee_name,
    email,
    phone_number,
    skills,
    ctc,                  // ✅ CTC
    resume,               // ✅ Resume path
    photo,                // ✅ Photo path
    "No",                 // ✅ salary_paid default
    billable,             // ✅ Billable ("Yes" or "No")
    consultant_regular,
    active,
    project_ending,
    date_of_joining
  ],
  function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      console.log(err);
    } else {
      res.json({ id: this.lastID, message: "Employee added successfully" });
    }
  }
);

  }
);

// GET API (fetch all employees)
app.get("/getemployees", (req, res) => {
  db.all("SELECT * FROM employees", [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

// GET AVailable Employees for Projects
app.get("/getAvailableEmployees", (req, res) => {
  const sql = `
    SELECT employee_id, employee_name
    FROM employees
    WHERE employee_id NOT IN (
      SELECT employeeID FROM Projects WHERE employeeID IS NOT NULL
    )
  `;
  db.all(sql, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows); // 👈 ensures it's an array
  });
});

// ✅ GET all salaries
app.get("/getallsalaries", (req, res) => {
  db.all(`SELECT * FROM salary_payments`, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// ✅ POST add salary
app.post("/addsalaries", (req, res) => {
  const {
    employee_id,
    employee_name,
    month,
    paid,
    paid_date,

    basic_pay,
    hra,
    conveyance_allowance,
    medical_allowance,
    lta,
    personal_allowance,
    gross_salary,
    ctc,

    professional_tax,
    insurance,
    pf,
    tds,

    employer_pf,
    employer_health_insurance,

    net_takehome,
  } = req.body;

  const query = `
    INSERT INTO salary_payments (
      employee_id, employee_name, month, paid, paid_date,
      basic_pay, hra, conveyance_allowance, medical_allowance,
      lta, personal_allowance, gross_salary, ctc,
      professional_tax, insurance, pf, tds,
      employer_pf, employer_health_insurance, net_takehome
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(
    query,
    [
      employee_id,
      employee_name,
      month,
      paid || "No",
      paid_date || null,
      basic_pay || 0,
      hra || 0,
      conveyance_allowance || 0,
      medical_allowance || 0,
      lta || 0,
      personal_allowance || 0,
      gross_salary || 0,
      ctc || 0,
      professional_tax || 0,
      insurance || 0,
      pf || 0,
      tds || 0,
      employer_pf || 0,
      employer_health_insurance || 0,
      net_takehome || 0,
    ],
    function (err) {
      if (err) {
        console.error("❌ Salary Insert Error:", err.message);
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, message: "Salary record added successfully" });
    }
  );
});

// GET AVailable Employees For Salaries
app.get("/getAvailableEmployeesForSalaries", (req, res) => {
  const sql = `
    SELECT employee_id, employee_name,ctc
    FROM employees
    WHERE employee_id NOT IN (
      SELECT employee_id FROM salary_payments WHERE employee_id IS NOT NULL
    )
  `;
  db.all(sql, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows); // 👈 ensures it's an array
  });
});

// Post Forecast
app.post("/forecasts", (req, res) => {
  const { name, start_date, end_date } = req.body;

  if (!name || !start_date || !end_date) {
    return res.status(400).json({ error: "All fields are required" });
  }

  db.run(
    `INSERT INTO forecasts (name, start_date, end_date) VALUES (?, ?, ?)`,
    [name, start_date, end_date],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, forecast_id: this.lastID });
    }
  );
});

// Get Forcasts
app.get("/forecasts", (req, res) => {
  db.all(`SELECT * FROM forecasts`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ forecasts: rows });
  });
});

// Update forcast End Date
app.put("/forecasts/:id", (req, res) => {
  const { id } = req.params;
  const { end_date } = req.body;

  if (!end_date) return res.status(400).json({ error: "End date is required" });

  db.run(
    `UPDATE forecasts SET end_date = ? WHERE id = ?`,
    [end_date, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Forecast not found" });

      res.json({ success: true, message: "End date updated successfully" });
    }
  );
});

// POST /transactions
app.post("/transactions", (req, res) => {
  const { forecast_id, name, type, amount, start_date, end_date, category } = req.body;

  if (!forecast_id || !name || !type || !amount || !start_date) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  db.get("SELECT end_date FROM forecasts WHERE id = ?", [forecast_id], (err, forecast) => {
    if (err) {
      console.error("DB Error:", err);
      return res.status(500).json({ error: err.message });
    }

    if (!forecast) {
      console.error("Forecast not found for id:", forecast_id);
      return res.status(404).json({ error: "Forecast not found" });
    }

    const finalEndDate = end_date || forecast.end_date;

    db.run(
      `INSERT INTO forecast_transactions (forecast_id, name, type, amount, start_date, end_date, category)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [forecast_id, name, type, amount, start_date, finalEndDate, category || null],
      function (err) {
        if (err) {
          console.error("Insert Error:", err);
          return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, transactionId: this.lastID });
      }
    );
  });
});

// Getting Particular Forcast Transactions
app.get("/transactions/:forecastId", (req, res) => {
  const forecastId = req.params.forecastId;

  const query = "SELECT * FROM forecast_transactions WHERE forecast_id = ?";

  db.all(query, [forecastId], (err, rows) => {
    if (err) {
      console.error("Fetch Error:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ transactions: rows });
  });
});

// Post Invoices
app.post("/invoices", (req, res) => {
  const {
    invoice_number,
    invoice_date,
    client_name,
    project_id,
    start_date,
    end_date,
    invoice_cycle,
    invoice_value,
    gst_amount,
    due_date,
    billable_days,
    received,
    received_date
  } = req.body;

  // First, get client's paymentTerms from ClientsTable
  db.get(
    "SELECT paymentTerms FROM ClientsTable WHERE clientName = ?",
    [client_name],
    (err, client) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error fetching client data" });
      }

      if (!client) {
        return res.status(400).json({ error: "Client not found" });
      }

      const paymentTerms = client.paymentTerms || 0;

      // Calculate due_date if not provided
      let finalDueDate = due_date;
      if (!finalDueDate || finalDueDate.trim() === "") {
        const d = new Date(invoice_date);
        d.setDate(d.getDate() + paymentTerms + 2); // as per your logic
        finalDueDate = d.toISOString().split("T")[0];
      }

      // Insert invoice
      const sql = `
        INSERT INTO invoices (
          invoice_number, invoice_date, client_name, project_id,
          start_date, end_date, invoice_cycle, invoice_value,
          gst_amount, due_date, billable_days, received, received_date
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      db.run(
        sql,
        [
          invoice_number,
          invoice_date,
          client_name,
          project_id,
          start_date,
          end_date,
          invoice_cycle,
          invoice_value,
          gst_amount,
          finalDueDate,
          billable_days,
          received || "No",
          received_date || null
        ],
        function (err) {
          if (err) {
            console.error("Insert error:", err);
            return res.status(500).json({ error: err.message });
          }
          res.json({ success: true, id: this.lastID });
        }
      );
    }
  );
});

// Get Invoices
app.get("/invoices", (req, res) => {
  const query = "SELECT * FROM invoices ORDER BY invoice_date DESC";

  db.all(query, [], (err, rows) => {
    if (err) {
      console.error("Fetch Invoices Error:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ invoices: rows });
  });
});

// GET client details + all their projects
app.get("/clientsprojects/:clientID", (req, res) => {
  const { clientID } = req.params;

  // Query client details
  const clientQuery = `SELECT * FROM ClientsTable WHERE id = ?`;

  db.get(clientQuery, [clientID], (err, client) => {
    if (err) {
      console.error("Error fetching client:", err.message);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    // Query only active projects linked to this client
    const projectQuery = `SELECT * FROM Projects WHERE clientID = ? AND active = 'Yes'`;

    db.all(projectQuery, [clientID], (err, projects) => {
      if (err) {
        console.error("Error fetching projects:", err.message);
        return res.status(500).json({ error: "Internal Server Error" });
      }

      res.json({
        client,
        projects,
      });
    });
  });
});


// GET Project by ID
app.get("/getProject/:id", (req, res) => {
  const { id } = req.params;
  const sql = "SELECT * FROM Projects WHERE projectID = ?";

  db.get(sql, [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ message: "Project not found" });
    }
    res.json(row);
  });
});

// API to fetch active projects
app.get("/getactive-projects", (req, res) => {
  const { filterMonthYear } = req.query; // e.g., "2025-09"

  // Default to current month if not provided
  const today = new Date();
  const yearMonth =
    filterMonthYear ||
    `${today.getFullYear()}-${(today.getMonth() + 1)
      .toString()
      .padStart(2, "0")}`;

  const sql = `
    SELECT p.*,
           c.clientName,
           i.*,
           COALESCE(t.total_invoice_amount, 0) AS total_invoice_amount
    FROM Projects p
    LEFT JOIN ClientsTable c ON c.id = p.clientID
    LEFT JOIN (
      SELECT *
      FROM invoices
      WHERE strftime('%Y-%m', invoice_date) = '${yearMonth}'
    ) i ON i.project_id = p.projectID
    LEFT JOIN (
      SELECT project_id, SUM(invoice_value) AS total_invoice_amount
      FROM invoices
      GROUP BY project_id
    ) t ON t.project_id = p.projectID
    WHERE p.active = 'Yes'
    ORDER BY p.projectID, i.invoice_date
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error("Error fetching active projects:", err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
    console.log(rows);
  });
});


// Prpoject without INvoice this Month
app.get("/getprojects-no-invoice-current-month", (req, res) => {
  const sql = `
    SELECT p.*
    FROM Projects p
    LEFT JOIN invoices i 
      ON p.projectID = i.project_id 
      AND strftime('%Y-%m', i.invoice_date) = strftime('%Y-%m', 'now') 
    WHERE p.active = 'Yes' 
      AND i.project_id IS NULL
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error("Error fetching projects without invoices for this month:", err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Update Project by ID
app.put("/update-project/:id", upload.single("purchaseOrder"), (req, res) => {
  const { id } = req.params;
  const data = req.body;
  const file = req.file ? req.file.filename : null;

  const sql = `
    UPDATE Projects
    SET clientID = ?, projectName = ?, projectDescription = ?, startDate = ?, 
        endDate = ?, skill = ?, projectLocation = ?, spoc = ?, mailID = ?, mobileNo = ?, 
        billingType = ?, billRate = ?, monthlyBilling = ?, employeeID = ?, employeeName = ?, 
        poNumber = ?, purchaseOrderValue = ?, active = ? ,invoiceCycle = ?
        ${file ? `, purchaseOrder = ?` : ""}
    WHERE projectID = ?
  `;

  const params = [
    data.clientID, data.projectName, data.projectDescription, data.startDate,
    data.endDate, data.skill, data.projectLocation, data.spoc, data.mailID, data.mobileNo,
    data.billingType, data.billRate, data.monthlyBilling, data.employeeID, data.employeeName,
    data.poNumber, data.purchaseOrderValue, data.active,data.invoiceCycle
  ];

  if (file) params.push(file);
  params.push(id);

  db.run(sql, params, function (err) {
    if (err) {
      console.error(err);
      return res.json({ success: false, error: err.message });
    }
    res.json({ success: true, changes: this.changes });
  });
});

// Update Client by ID
app.put("/update-client/:id", (req, res) => {
  const clientId = req.params.id;
  const {
    clientName,
    aboutClient,
    paymentTerms,
    location,
    contactSpoc,
    contactEmail,
    contactNumber,
    gstApplicable,
    gstNumber,
    gstPercentage,
  } = req.body;

  const sql = `
    UPDATE ClientsTable
    SET clientName = ?,
        aboutClient = ?,
        paymentTerms = ?,
        location = ?,
        contactSpoc = ?,
        contactEmail = ?,
        contactNumber = ?,
        gstApplicable = ?,
        gstNumber = ?,
        gstPercentage = ?
    WHERE id = ?
  `;

  db.run(
    sql,
    [
      clientName,
      aboutClient,
      paymentTerms,
      location,
      contactSpoc,
      contactEmail,
      contactNumber,
      gstApplicable,
      gstNumber,
      gstPercentage,
      clientId,
    ],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: err.message });
      }
      res.json({ success: true });
    }
  );
});

// Update Employee by ID
app.put("/employees/:id", upload.fields([
  { name: "resume", maxCount: 1 },
  { name: "photo", maxCount: 1 }
]), (req, res) => {
  const employeeId = req.params.id;

  const {
    employee_id,
    employee_name,
    email,
    phone_number,
    skills,
    salary_paid,
    billable,
    consultant_regular,
    active,
    ctc,
    project_ending,
    date_of_joining,
  } = req.body;

  // Ensure uploaded files are stored with "uploads/" path
  const resume = req.files?.resume ? `uploads/${req.files.resume[0].filename}` : null;
  const photo  = req.files?.photo  ? `uploads/${req.files.photo[0].filename}`  : null;

  const fields = [
    { key: "employee_id", value: employee_id },
    { key: "employee_name", value: employee_name },
    { key: "email", value: email },
    { key: "phone_number", value: phone_number },
    { key: "skills", value: skills },
    { key: "salary_paid", value: salary_paid },
    { key: "billable", value: billable },
    { key: "consultant_regular", value: consultant_regular },
    { key: "active", value: active },
    { key: "project_ending", value: project_ending },
    { key: "ctc", value: ctc },
    { key: "resume", value: resume },
    { key: "photo", value: photo },
    { key: "date_of_joining", value: date_of_joining },
  ].filter(f => f.value !== null && f.value !== undefined);

  const setClause = fields.map(f => `${f.key} = ?`).join(", ");
  const values = fields.map(f => f.value);
  values.push(employeeId); // for WHERE clause

  const sql = `UPDATE employees SET ${setClause} WHERE id = ?`;

  db.run(sql, values, function(err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, changes: this.changes });
  });
});



// Delete Employee by ID
app.delete("/employees/:id", (req, res) => {
  const { id } = req.params;
  const sql = `DELETE FROM employees WHERE id = ?`;

  db.run(sql, [id], function(err) {
    if (err) {
      console.error(err.message);
      return res.status(500).json({ error: "Failed to delete employee" });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: "Employee not found" });
    }
    res.json({ message: "Employee deleted successfully" });
  });
});

// Delete Project by ID
app.delete("/deleteproject/:id", (req, res) => {
  const { id } = req.params;

  const query = `DELETE FROM Projects WHERE projectID = ?`;
  db.run(query, [id], function (err) {
    if (err) {
      console.error(err.message);
      return res.status(500).json({ message: "Failed to delete project" });
    }

    if (this.changes === 0) {
      return res.status(404).json({ message: "Project not found" });
    }

    res.json({ message: "Project deleted successfully" });
  });
});

// Delete Client by ID
app.delete("/deleteclient/:id", (req, res) => {
  const { id } = req.params;
  const query = `DELETE FROM ClientsTable WHERE id = ?`;

  db.run(query, [id], function(err) {
    if (err) {
      console.error(err.message);
      return res.status(500).json({ message: "Failed to delete client" });
    }
    if (this.changes === 0) {
      return res.status(404).json({ message: "Client not found" });
    }
    res.json({ message: "Client deleted successfully" });
  });
});

// GET /invoices/month/:month
// month format: YYYY-MM
app.get("/invoices/month/:month", (req, res) => {
  const { month } = req.params; // e.g., "2025-09"

  if (!month.match(/^\d{4}-\d{2}$/)) {
    return res.status(400).json({ error: "Invalid month format. Use YYYY-MM." });
  }

  const sql = `
    SELECT * FROM invoices
    WHERE due_date LIKE ?
    ORDER BY due_date ASC
  `;

  const param = month + "%"; // matches all dates in that month

  db.all(sql, [param], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Update invoice API
app.put("/invoices/:id", (req, res) => {
  const id = req.params.id;
  const inv = req.body;

  const query = `
    UPDATE invoices
    SET
      invoice_number = ?,
      invoice_date = ?,
      client_name = ?,
      project_id = ?,
      start_date = ?,
      end_date = ?,
      invoice_cycle = ?,
      invoice_value = ?,
      gst_amount = ?,
      due_date = ?,
      billable_days = ?,
      received = ?,
      received_date = ?
    WHERE id = ?
  `;

  db.run(
    query,
    [
      inv.invoice_number,
      inv.invoice_date || "",
      inv.client_name,
      inv.project_id,
      inv.start_date,
      inv.end_date,
      inv.invoice_cycle,
      inv.invoice_value,
      inv.gst_amount,
      inv.due_date,
      inv.billable_days,
      inv.received,
      inv.received_date || null,
      id,
    ],
    function (err) {
      if (err) return res.status(500).json({ message: err.message });
      // Return updated invoice
      db.get("SELECT * FROM invoices WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json({ message: err.message });
        res.json(row);
      });
    }
  );
});

// Update Received Status and Received Date
app.put("/updateinvoices/:id", (req, res) => {
  const { id } = req.params;
  const { received, received_date } = req.body;
  if (!["Yes", "No"].includes(received)) {
    return res.status(400).json({ error: "Received must be 'Yes' or 'No'" });
  }

  // If No, remove received_date
  const updatedDate = received === "Yes" ? received_date || null : null;

  const query = `
    UPDATE invoices
    SET received = ?, received_date = ?
    WHERE id = ?
  `;

  db.run(query, [received, updatedDate, id], function (err) {
    if (err) {
      console.error("Error updating invoice:", err);
      return res.status(500).json({ error: "Failed to update invoice" });
    }

    // Return the updated invoice
    db.get("SELECT * FROM invoices WHERE id = ?", [id], (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to fetch updated invoice" });
      }
      res.json(row);
    });
  });
});


// API to save monthly salary
app.post("/monthlySalary/save", (req, res) => {
  const {
    empId,
    empName,
    paid,
    month,
    lop,
    paidAmount,
    actualToPay,
  } = req.body;

  const query = `
    INSERT INTO monthly_salary_payments
    (employee_id, employee_name, paid, month, lop, paid_amount, actual_to_pay)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(
    query,
    [empId, empName, paid, month, lop, paidAmount, actualToPay],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "DB error" });
      }
      return res.json({ success: true, message: "Salary saved successfully", id: this.lastID });
    }
  );
});

// Get monthly salary by month
app.get("/monthlySalary", (req, res) => {
  const query = `
    SELECT * FROM monthly_salary_payments
    ORDER BY month DESC, employee_name
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      console.error("DB Error:", err);
      return res.status(500).json({ success: false, message: "Database error" });
    }

    if (!rows || rows.length === 0) {
      return res.json({ success: true, data: [], message: "No records found" });
    }

    return res.json({ success: true, data: rows });
  });
});

// GET all expenses
// app.get("/getexpenses", (req, res) => {
//   db.all("SELECT * FROM expenses ORDER BY auto_id DESC", [], (err, rows) => {
//     if (err) {
//       console.error("DB Query Error:", err.message);
//       return res.status(500).json({ error: err.message });
//     }

//     const formatted = rows.map(row => ({
//       id: `E${row.auto_id}`,
//       regular: row.regular,
//       type: row.type,
//       description: row.description,
//       amount: row.amount,
//       currency: row.currency,
//       raised_date: row.raised_date,
//       paid_date: row.paid_date,
//       due_date: row.due_date,
//       paid_amount: row.paid_amount,
//       status:row.status
//     }));
//     // console.log("Expenses fetched:", formatted.length);
//     res.json(formatted);
//   });
// });
app.get("/getexpenses", (req, res) => {
  const { month } = req.query; // format: "YYYY-MM"
  if (!month) return res.status(400).json({ error: "Month is required (YYYY-MM)" });

  const selectedYear = parseInt(month.split("-")[0]);
  const selectedMonth = parseInt(month.split("-")[1]);

  const sql = `
    SELECT 
      e.auto_id,
      e.regular,
      e.type,
      e.description,
      e.amount,
      e.currency,
      e.raised_date,
      e.due_date,
      e.status AS expense_status,   -- <-- status from expenses table
      ep.paid_amount,
      ep.paid_date,
      ep.status AS payment_status   -- <-- status from expense_payments table
    FROM expenses e
    LEFT JOIN expense_payments ep
      ON e.auto_id = ep.expense_id AND ep.month_year = ?
    ORDER BY e.auto_id DESC
  `;

  db.all(sql, [month], (err, rows) => {
    if (err) {
      console.error("DB Query Error:", err.message);
      return res.status(500).json({ error: err.message });
    }

    const filtered = rows.filter(row => {
      const raised = new Date(row.raised_date);
      const raisedYear = raised.getFullYear();
      const raisedMonth = raised.getMonth() + 1;

      if (row.regular === "Yes") {
        return (
          selectedYear > raisedYear ||
          (selectedYear === raisedYear && selectedMonth >= raisedMonth)
        );
      } else {
        return selectedYear === raisedYear && selectedMonth === raisedMonth;
      }
    });

    const formatted = filtered.map(row => ({
      id: `E${row.auto_id}`,
      regular: row.regular,
      type: row.type,
      description: row.description,
      amount: row.amount,
      currency: row.currency,
      raised_date: row.raised_date,
      due_date: row.due_date,
      paid_amount: row.paid_amount || null,
      paid_date: row.paid_date || null,
      // Prioritize payment table status if exists, else fallback to expense table status
      paymentstatus: row.payment_status || null,
      expensestatus: row.expense_status || null,
    }));

    res.json(formatted);
  });
});

// POST expense
app.post("/postexpenses", (req, res) => {
  const { regular, type, description, amount, currency, raised_date, due_date, paid_date, paid_amount, status } = req.body;

  // Validate required fields
  if (!regular || !type || !amount || !raised_date || !due_date) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const query = `
    INSERT INTO expenses (regular, type, description, amount, currency, raised_date, due_date, paid_date, paid_amount, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    regular,
    type,
    description || "",
    amount,
    currency || "INR",
    raised_date,
    due_date,
    paid_date || "00-00-0000",
    paid_amount || 0,
    status || "Raised"
  ];

  db.run(query, params, function(err) {
    if (err) {
      console.error("DB Insert Error:", err.message);
      return res.status(500).json({ error: err.message });
    }

    res.json({
      id: `E${this.lastID}`,
      regular,
      type,
      description: description || "",
      amount,
      currency: currency || "INR",
      raised_date,
      due_date,
      paid_date: paid_date || "00-00-0000",
      paid_amount: paid_amount || 0,
      status: status || "Raised"
    });
  });
});

// API: Mark expense as paid
app.put("/markaspaid/:id", (req, res) => {
  let { id } = req.params;          // id will be like "E1"
  const { paid_date, paid_amount, status } = req.body;

  // Remove the leading 'E' to get numeric auto_id
  if (id.startsWith("E")) {
    id = parseInt(id.substring(1), 10);
  }

  db.run(
    `UPDATE expenses SET paid_date = ?, paid_amount = ?, status = ? WHERE auto_id = ?`,
    [paid_date, paid_amount, status, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Expense not found" });
      res.json({ message: "Expense marked as paid successfully" });
    }
  );
});

app.post("/pay-expense", (req, res) => {
  const { expense_id, paid_amount, paid_date } = req.body;
  console.log(req.body)

  if (!expense_id || !paid_amount || !paid_date) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const month_year = paid_date.slice(0, 7); // e.g. "2025-10"

  // Step 1: Get the actual amount for this expense from main table
  const getAmountSQL = `SELECT amount, regular FROM expenses WHERE auto_id = ?`;

  db.get(getAmountSQL, [expense_id], (err, expense) => {
    if (err) {
      console.error("❌ Error fetching expense:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (!expense) {
      return res.status(404).json({ error: "Expense not found" });
    }

    const actual_amount = expense.amount;

    // Step 2: Insert or update the expense_payments table
    const insertSQL = `
      INSERT INTO expense_payments (expense_id, month_year, actual_amount, paid_amount, paid_date, status)
      VALUES (?, ?, ?, ?, ?, 'Paid')
      ON CONFLICT(expense_id, month_year) DO UPDATE SET
        paid_amount = excluded.paid_amount,
        paid_date = excluded.paid_date,
        status = 'Paid';
    `;

    db.run(insertSQL, [expense_id, month_year, actual_amount, paid_amount, paid_date], function (err2) {
      if (err2) {
        console.error("❌ Error inserting into expense_payments:", err2);
        return res.status(500).json({ error: "Database error" });
      }

      res.json({ message: "✅ Payment recorded successfully!" });
    });
  });
});

app.put("/updateexpense/:id", (req, res) => {
  let { id } = req.params;
  const {
    regular,
    amount,
    raised_date,
    due_date,
    status,
    month_year, // must be sent from frontend: format "YYYY-MM"
  } = req.body;

  id = id.replace("E", ""); // convert E9 → 9

  // 1️⃣ Update base expense details
  const updateExpenseSql = `
    UPDATE expenses
    SET regular = ?, amount = ?, raised_date = ?, due_date = ?, status = ?
    WHERE auto_id = ?
  `;

  db.run(updateExpenseSql, [regular, amount, raised_date, due_date, status, id], function (err) {
    if (err) {
      console.error("Error updating expenses:", err.message);
      return res.status(500).json({ error: err.message });
    }

    // 2️⃣ Update or insert status in expense_payments
    const updatePaymentSql = `
      INSERT INTO expense_payments (expense_id, month_year, actual_amount, status)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(expense_id, month_year)
      DO UPDATE SET status = excluded.status
    `;

    db.run(updatePaymentSql, [id, month_year, amount, status], function (err2) {
      if (err2) {
        console.error("Error updating expense_payments:", err2.message);
        return res.status(500).json({ error: err2.message });
      }

      res.json({ message: "Expense and payment status updated successfully!" });
    });
  });
});

































app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
