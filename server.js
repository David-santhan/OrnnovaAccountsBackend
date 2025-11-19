
// app.listen(port, () => {
//   console.log(`Server running at http://localhost:${port}`);
// });

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
app.locals.db = db;


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
  gst INTEGER,
  tds INTEGER,
  netPayable INTEGER,
  employees TEXT, -- ✅ JSON array of employees
  hoursOrDays REAL,
  poNumber TEXT,
  purchaseOrder TEXT,
  purchaseOrderValue REAL,
  active TEXT CHECK(active IN ('Yes','No')),
  invoiceCycle TEXT CHECK(invoiceCycle IN ('Monthly', 'Quarterly')),
  FOREIGN KEY (clientID) REFERENCES Clients(id) ON DELETE CASCADE
);
`
)

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


// Invoices Table
db.run(`
  CREATE TABLE IF NOT EXISTS invoices (
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
    non_billable_days INTEGER,
    received TEXT CHECK(received IN ('Yes','No')) DEFAULT 'No',
    received_date TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Monthly Salary Payments Table
db.run(`
  CREATE TABLE IF NOT EXISTS monthly_salary_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT NOT NULL,
    employee_name TEXT NOT NULL,
    paid TEXT CHECK(paid IN ('Yes','No')) NOT NULL DEFAULT 'No',
    month TEXT NOT NULL, -- Format: YYYY-MM
    lop REAL DEFAULT 0, -- Loss of Pay
    paid_amount REAL DEFAULT 0,
    actual_to_pay REAL DEFAULT 0,
    paid_date TEXT,
    due_date TEXT,
    FOREIGN KEY(employee_id) REFERENCES salary_payments(employee_id) ON UPDATE CASCADE ON DELETE CASCADE
  );
`);

// Expenses DB
db.run(`
  CREATE TABLE IF NOT EXISTS expenses (
    auto_id INTEGER PRIMARY KEY AUTOINCREMENT,
    regular TEXT CHECK(regular IN ('Yes','No')),
    type TEXT NOT NULL,
    description TEXT,
    amount REAL NOT NULL, -- Expected expense amount
    currency TEXT DEFAULT 'INR',
    raised_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    paid_date TEXT,
    paid_amount REAL,
    Active TEXT,
    status TEXT CHECK(status IN ('Raised','Paid','Cancelled')) DEFAULT 'Raised'
  );
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
    due_date TEXT,
    FOREIGN KEY (expense_id) REFERENCES expenses(auto_id),
    UNIQUE(expense_id, month_year)
  );
`);

// 1️⃣ Accounts Table
db.run(`
  CREATE TABLE IF NOT EXISTS accounts (
    account_id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_number TEXT UNIQUE NOT NULL,
    account_name TEXT NOT NULL,
    account_type TEXT CHECK(account_type IN ('Capital','Current')) NOT NULL,
    balance REAL DEFAULT 0,
    is_hidden INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// 2️⃣ Transactions Table
db.run(`
  CREATE TABLE IF NOT EXISTS transactions (
  transaction_id TEXT PRIMARY KEY,
  account_number TEXT NOT NULL,
  type TEXT CHECK(type IN ('Credit','Debit','Transfer')) NOT NULL,
  description TEXT,
  amount REAL NOT NULL,
  previous_balance REAL NOT NULL,  -- ✅ balance before transaction
  updated_balance REAL NOT NULL,   -- ✅ balance after transaction
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(account_number) REFERENCES accounts(account_number)
);

`);
// function dropTableWithRetry(db, retries = 5) {
//   db.run("DROP TABLE IF EXISTS invoices;", (err) => {
//     if (err && err.code === "SQLITE_BUSY" && retries > 0) {
//       console.warn("⚠️ Database locked. Retrying in 500ms...");
//       setTimeout(() => dropTableWithRetry(db, retries - 1), 500);
//     } else if (err) {
//       console.error("❌ Error dropping table:", err);
//     } else {
//       console.log("✅ Table dropped successfully.");
//     }
//   });
// }

// dropTableWithRetry(db);

function generateMonthRange(start, end) {
  const startDate = new Date(start + "-01");
  const endDate = new Date(end + "-01");
  const months = [];

  while (startDate <= endDate) {
    months.push(startDate.toISOString().slice(0, 7));
    startDate.setMonth(startDate.getMonth() + 1);
  }

  return months;
}


function generateMonthRange(start, end) {
  const startDate = new Date(start + "-01");
  const endDate = new Date(end + "-01");
  const months = [];
 
  while (startDate <= endDate) {
    months.push(startDate.toISOString().slice(0, 7));
    startDate.setMonth(startDate.getMonth() + 1);
  }
 
  return months;
}


function runQuery(query) {
  return new Promise((resolve, reject) => {
    db.all(query, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows || []);
      }
    });
  });
}



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
    gst,tds,netPayable,
    employees, // ✅ from frontend as JSON
    hoursOrDays,
    poNumber,
    purchaseOrderValue,
    active,
    invoiceCycle,
  } = req.body;

  const purchaseOrderFile = req.file ? req.file.filename : null;

  getUniqueProjectID(db, clientID, projectName, (err, uniqueID) => {
    if (err) {
      console.error("Error generating projectID:", err);
      return res.status(500).json({ error: "Failed to generate project ID" });
    }

    let employeesData = [];
    try {
      employeesData = typeof employees === "string" ? JSON.parse(employees) : employees;
    } catch (e) {
      console.error("Error parsing employees JSON:", e);
    }

    const query = `
      INSERT INTO Projects (
        projectID, clientID, startDate, endDate, projectName, projectDescription,
        skill, projectLocation, spoc, mailID, mobileNo, billingType, billRate,
        monthlyBilling,gst,tds,netPayable, employees,hoursOrDays, poNumber, purchaseOrder, purchaseOrderValue,
        active, invoiceCycle
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,?,?,?)
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
        gst,tds,netPayable,
        JSON.stringify(employeesData), // ✅ store JSON
        hoursOrDays,
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

    db.all("SELECT employee_id, employee_name FROM employees", [], (err, emps) => {
      if (err) return res.status(500).json({ error: err.message });

      const map = new Map(emps.map(e => [e.employee_id, e.employee_name]));
      const formatted = rows.map(row => {
        let parsed = [];
        try {
          const arr = JSON.parse(row.employees || "[]");
          parsed = arr.map(emp => ({
            id: typeof emp === "string" ? emp : emp.id,
            name: typeof emp === "string" ? map.get(emp) : emp.name,
          }));
        } catch {
          parsed = [];
        }
        return { ...row, employees: parsed };
      });

      res.json(formatted);
    });
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
  db.all(`SELECT employee_id, employee_name FROM employees`, [], (err, allEmployees) => {
    if (err) return res.status(500).json({ error: err.message });

    db.all(`SELECT employees FROM Projects WHERE employees IS NOT NULL`, [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      const assigned = new Set();

      rows.forEach(row => {
        try {
          const parsed = JSON.parse(row.employees || "[]");
          parsed.forEach(emp => {
            if (typeof emp === "string") assigned.add(emp);
            else if (emp.id) assigned.add(emp.id);
          });
        } catch (e) {
          console.error("JSON parse error:", e);
        }
      });

      const available = allEmployees.filter(emp => !assigned.has(emp.employee_id));
      res.json(available);
    });
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
// app.post("/addsalaries", (req, res) => {
//   const {
//     employee_id,
//     employee_name,
//     month,
//     paid,
//     paid_date,

//     basic_pay,
//     hra,
//     conveyance_allowance,
//     medical_allowance,
//     lta,
//     personal_allowance,
//     gross_salary,
//     ctc,

//     professional_tax,
//     insurance,
//     pf,
//     tds,

//     employer_pf,
//     employer_health_insurance,

//     net_takehome,
//   } = req.body;

//   const query = `
//     INSERT INTO salary_payments (
//       employee_id, employee_name, month, paid, paid_date,
//       basic_pay, hra, conveyance_allowance, medical_allowance,
//       lta, personal_allowance, gross_salary, ctc,
//       professional_tax, insurance, pf, tds,
//       employer_pf, employer_health_insurance, net_takehome
//     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
//   `;

//   db.run(
//     query,
//     [
//       employee_id,
//       employee_name,
//       month,
//       paid || "No",
//       paid_date || null,
//       basic_pay || 0,
//       hra || 0,
//       conveyance_allowance || 0,
//       medical_allowance || 0,
//       lta || 0,
//       personal_allowance || 0,
//       gross_salary || 0,
//       ctc || 0,
//       professional_tax || 0,
//       insurance || 0,
//       pf || 0,
//       tds || 0,
//       employer_pf || 0,
//       employer_health_insurance || 0,
//       net_takehome || 0,
//     ],
//     function (err) {
//       if (err) {
//         console.error("❌ Salary Insert Error:", err.message);
//         return res.status(500).json({ error: err.message });
//       }
//       res.json({ id: this.lastID, message: "Salary record added successfully" });
//     }
//   );
// });

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

  const insertSalaryQuery = `
    INSERT INTO salary_payments (
      employee_id, employee_name, month, paid, paid_date,
      basic_pay, hra, conveyance_allowance, medical_allowance,
      lta, personal_allowance, gross_salary, ctc,
      professional_tax, insurance, pf, tds,
      employer_pf, employer_health_insurance, net_takehome
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(
    insertSalaryQuery,
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
function getLastDateOfMonth(yyyymm) {
  const [year, month] = yyyymm.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return `${yyyymm}-${String(lastDay).padStart(2, "0")}`;
}

const raised_date = `${month}-01`;
const due_date = paid_date || getLastDateOfMonth(month);


      // ------------------------------------
      // CREATE MULTIPLE EXPENSE ENTRIES
      // ------------------------------------

      const expensesToInsert = [];

      // 1️⃣ Salary Expense (use net_takehome instead of gross)
      expensesToInsert.push({
        type: `Salary - ${employee_name} (${employee_id})`,
        description: `Salary for ${month}`,
        amount: net_takehome || 0,
      });

      // 2️⃣ TDS - Monthly Value (tds/12)
      if (tds > 0) {
        expensesToInsert.push({
          type: `TDS - ${employee_name} (${employee_id})`,
          description: `Monthly TDS Contribution (${month})`,
          amount: (tds / 12).toFixed(2),
        });
      }

      // 3️⃣ PF
      if (pf > 0) {
        expensesToInsert.push({
          type: `PF - ${employee_name} (${employee_id})`,
          description: `PF for ${month}`,
          amount: pf,
        });
      }

      // 4️⃣ Professional Tax
      if (professional_tax > 0) {
        expensesToInsert.push({
          type: `Professional Tax - ${employee_name} (${employee_id})`,
          description: `Professional Tax for ${month}`,
          amount: professional_tax,
        });
      }

      // 5️⃣ Insurance
      if (insurance > 0) {
        expensesToInsert.push({
          type: `Insurance - ${employee_name} (${employee_id})`,
          description: `Insurance for ${month}`,
          amount: insurance,
        });
      }

      // Insert into expenses table
      const insertExpenseQuery = `
        INSERT INTO expenses (
          regular, type, description, amount,
          currency, raised_date, due_date, paid_date,
          paid_amount, Active, status
        ) VALUES (?, ?, ?, ?, 'INR', ?, ?, NULL, NULL, 'Yes', 'Raised')
      `;

      expensesToInsert.forEach(exp => {
        db.run(insertExpenseQuery, [
          "Yes",
          exp.type,
          exp.description,
          exp.amount,
          raised_date,
          due_date
        ]);
      });

      res.json({
        message: "Salary and expenses created successfully",
        salary_payment_id: this.lastID,
        expenses_created: expensesToInsert.length
      });
    }
  );
});

// GET Available Employees For Salaries
app.get("/getAvailableEmployeesForSalaries", (req, res) => {
  const sql = `
    SELECT employee_id, employee_name, ctc, date_of_joining
    FROM employees
    WHERE employee_id NOT IN (
      SELECT employee_id FROM salary_payments WHERE employee_id IS NOT NULL
    )
  `;
  db.all(sql, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
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

// Post Invoices and GST Expense Adding
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
    non_billable_days,
    received,
    received_date
  } = req.body;

  // Step 1: Get client's paymentTerms
  db.get(
    "SELECT paymentTerms FROM ClientsTable WHERE clientName = ?",
    [client_name],
    (err, client) => {
      if (err) return res.status(500).json({ error: "Error fetching client data" });
      if (!client) return res.status(400).json({ error: "Client not found" });

      const paymentTerms = client.paymentTerms || 0;

      // Calculate due_date if missing
      let finalDueDate = due_date;
      if (!finalDueDate || finalDueDate.trim() === "") {
        const d = new Date(invoice_date);
        d.setDate(d.getDate() + paymentTerms + 2);
        finalDueDate = d.toISOString().split("T")[0];
      }

      // Step 2: Insert Invoice
      const sql = `
        INSERT INTO invoices (
          invoice_number, invoice_date, client_name, project_id,
          start_date, end_date, invoice_cycle, invoice_value,
          gst_amount, due_date, billable_days, non_billable_days, received, received_date
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          non_billable_days,
          received || "No",
          received_date || null
        ],
        function (err) {
          if (err) {
            console.error("Insert error:", err);
            return res.status(500).json({ error: err.message });
          }

          const invoiceId = this.lastID;

          // =====================================
          // Step 3: Insert GST Expense Automatically
          // =====================================

          const raisedDate = new Date(invoice_date);

// Convert raisedDate to YYYY-MM-DD
const formattedRaisedDate = raisedDate.toISOString().split("T")[0];

// Get next month of raised date
const nextMonth = new Date(
  raisedDate.getFullYear(),
  raisedDate.getMonth() + 1,
  20
);
const gstDueDate = nextMonth.toISOString().split("T")[0];

          const expSql = `
            INSERT INTO expenses (
              regular, type, description, amount, currency, 
              raised_date, due_date, paid_date, paid_amount, 
              Active, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;

          const descriptionText = `GST for Invoice ${invoice_number} from ${start_date} to ${end_date}`;

          db.run(
            expSql,
            [
              "No",
              "GST",
              descriptionText,
              gst_amount,
              "INR",
              formattedRaisedDate,
              gstDueDate,
              null,
              null,
              "Yes",
              "Raised"
            ],
            function (expErr) {
              if (expErr) {
                console.error("Expense Insert Error:", expErr);
                return res.status(500).json({ error: expErr.message });
              }

              // FINAL RESPONSE
              res.json({
                success: true,
                invoice_id: invoiceId,
                expense_id: this.lastID,
                message: "Invoice and GST expense saved successfully"
              });
            }
          );
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

  // ✅ Handle employees JSON array safely
  let employeesData = [];
  try {
    employeesData = typeof data.employees === "string"
      ? JSON.parse(data.employees)
      : data.employees;
  } catch (err) {
    console.error("Error parsing employees JSON:", err);
  }

  // ✅ Base SQL (purchaseOrder condition handled below)
  let sql = `
    UPDATE Projects
    SET 
      clientID = ?, 
      projectName = ?, 
      projectDescription = ?, 
      startDate = ?, 
      endDate = ?, 
      skill = ?, 
      projectLocation = ?, 
      spoc = ?, 
      mailID = ?, 
      mobileNo = ?, 
      billingType = ?, 
      billRate = ?, 
      monthlyBilling = ?, 
      gst = ?,
      tds = ?,
      netPayable = ?,
      employees = ?,
      hoursOrDays = ?,
      poNumber = ?, 
      purchaseOrderValue = ?, 
      active = ?, 
      invoiceCycle = ?
  `;

  // ✅ Add purchaseOrder if file uploaded
  if (file) sql += `, purchaseOrder = ?`;

  sql += ` WHERE projectID = ?`;

  // ✅ Prepare parameters
  const params = [
    data.clientID,
    data.projectName,
    data.projectDescription,
    data.startDate,
    data.endDate,
    data.skill,
    data.projectLocation,
    data.spoc,
    data.mailID,
    data.mobileNo,
    data.billingType,
    data.billRate,
    data.monthlyBilling,
    data.gst,
    data.tds,
    data.netPayable,
    JSON.stringify(employeesData || []), // ✅ Store employees as JSON
    data.hoursOrDays,
    data.poNumber,
    data.purchaseOrderValue,
    data.active,
    data.invoiceCycle,
  ];

  if (file) params.push(file);
  params.push(id);

  // ✅ Execute update query
  db.run(sql, params, function (err) {
    if (err) {
      console.error("DB Error:", err);
      return res.status(500).json({ success: false, error: err.message });
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

  // ✅ 1. Validate input
  if (!["Yes", "No"].includes(received)) {
    return res.status(400).json({ error: "Received must be 'Yes' or 'No'" });
  }

  // ✅ 2. Handle received date
  const updatedDate = received === "Yes" ? received_date || null : null;

  const updateInvoiceQuery = `
    UPDATE invoices
    SET received = ?, received_date = ?
    WHERE id = ?
  `;

  // ✅ 3. Update invoice
  db.run(updateInvoiceQuery, [received, updatedDate, id], function (err) {
    if (err) {
      console.error("❌ Error updating invoice:", err);
      return res.status(500).json({ error: "Failed to update invoice" });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    console.log(`✅ Invoice ${id} updated with received=${received}, date=${updatedDate}`);

    // ✅ 4. Fetch updated invoice
    db.get("SELECT * FROM invoices WHERE id = ?", [id], (err, invoice) => {
      if (err) {
        console.error("❌ Error fetching updated invoice:", err);
        return res.status(500).json({ error: "Failed to fetch updated invoice" });
      }

      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found after update" });
      }

      // ✅ 5. Fetch Current Account
      db.get(
        "SELECT account_number, balance FROM accounts WHERE account_type = 'Current' LIMIT 1",
        (err, account) => {
          if (err) {
            console.error("❌ Error fetching current account:", err);
            return res.status(500).json({ error: "Failed to fetch current account" });
          }

          if (!account) {
            return res.status(400).json({ error: "No current account found" });
          }

          // ✅ 6. Calculate Amount (Invoice Value - GST)
          const invoiceNumber = invoice.invoice_number;
          const amount =
            (Number(invoice.invoice_value) || 0) -
            (Number(invoice.gst_amount) || 0);
          const accountNumber = account.account_number;
          const previousBalance = Number(account.balance) || 0;
          let updatedBalance, type, description, transactionId;

          // ✅ 7. Generate Timestamp for Transaction ID (ddMMyyHH)
          const now = new Date();
          const timestamp = `${String(now.getDate()).padStart(2, "0")}${String(
            now.getMonth() + 1
          ).padStart(2, "0")}${String(now.getFullYear()).slice(-2)}${String(
            now.getHours()
          ).padStart(2, "0")}`;

          if (received === "Yes") {
            transactionId = `CRD|${invoiceNumber}|${timestamp}`;
            type = "Credit";
            description = `Payment received for invoice ${invoiceNumber}`;
            updatedBalance = previousBalance + amount;
          } else {
            transactionId = `DED|${invoiceNumber}|${timestamp}`;
            type = "Debit";
            description = `Payment reversed for invoice ${invoiceNumber}`;
            updatedBalance = previousBalance - amount;
          }

          // ✅ 8. Insert Transaction Record
          const insertTransactionQuery = `
            INSERT INTO transactions 
              (transaction_id, account_number, type, description, amount, previous_balance, updated_balance)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `;

          db.run(
            insertTransactionQuery,
            [
              transactionId,
              accountNumber,
              type,
              description,
              amount,
              previousBalance,
              updatedBalance,
            ],
            function (err) {
              if (err) {
                if (err.message.includes("UNIQUE constraint failed")) {
                  console.warn(`⚠️ Transaction already exists for ${transactionId}`);
                } else {
                  console.error("❌ Error inserting transaction:", err);
                  return res.status(500).json({ error: "Failed to insert transaction" });
                }
              } else {
                console.log(`✅ Transaction recorded: ${transactionId}`);
              }

              // ✅ 9. Update Account Balance
              db.run(
                "UPDATE accounts SET balance = ? WHERE account_number = ?",
                [updatedBalance, accountNumber],
                (err) => {
                  if (err) {
                    console.error("❌ Error updating account balance:", err);
                    return res.status(500).json({ error: "Failed to update account balance" });
                  }

                  console.log(
                    `💰 Account ${accountNumber} updated: Old=${previousBalance}, New=${updatedBalance}`
                  );

                  // ✅ 10. Send Response
                  res.json({
                    message:
                      received === "Yes"
                        ? "Invoice marked as received, credited to account successfully."
                        : "Invoice marked as not received, amount reversed successfully.",
                    invoice,
                    transaction: {
                      transaction_id: transactionId,
                      type,
                      amount,
                      description,
                      account_number: accountNumber,
                      previous_balance: previousBalance,
                      updated_balance: updatedBalance,
                    },
                    updated_balance: updatedBalance,
                  });
                }
              );
            }
          );
        }
      );
    });
  });
});



// app.post("/monthlySalary/save", (req, res) => {
//   const { empId, empName, paid, month, lop, paidAmount, actualToPay } = req.body;

//   if (!empId || !empName || !month) {
//     return res.status(400).json({ success: false, message: "Missing required fields" });
//   }

//   // 1️⃣ Save salary record
//   db.run(
//     `
//     INSERT INTO monthly_salary_payments 
//     (employee_id, employee_name, paid, month, lop, paid_amount, actual_to_pay)
//     VALUES (?, ?, ?, ?, ?, ?, ?)
//     `,
//     [empId, empName, paid, month, lop, paidAmount, actualToPay],
//     function (err) {
//       if (err) {
//         console.error("Error saving salary:", err);
//         return res.status(500).json({ success: false, message: "Database error" });
//       }

//       const salaryId = this.lastID;

app.put("/monthlySalary/update/:employeeId/:month", (req, res) => {
  const { employeeId, month } = req.params;
  const { paid, lop, paidAmount, actualToPay } = req.body;

  if (!paid || !month) {
    return res.status(400).json({
      success: false,
      message: "Paid status and month are required",
    });
  }

  const paidDate = paid === "Yes" ? new Date().toISOString().slice(0, 10) : null;

  const query = `
    UPDATE monthly_salary_payments
    SET 
      paid = ?, 
      lop = ?, 
      paid_amount = ?, 
      actual_to_pay = ?, 
      paid_date = ?
    WHERE employee_id = ? AND month = ?
  `;

  db.run(
    query,
    [
      paid,
      lop || 0,
      paidAmount || 0,
      actualToPay || 0,
      paidDate,
      employeeId,
      month,
    ],
    function (err) {
      if (err) {
        console.error("❌ Error updating salary:", err);
        return res.status(500).json({
          success: false,
          message: "Database update failed",
        });
      }

      if (this.changes === 0) {
        return res.status(404).json({
          success: false,
          message: "No salary record found for this employee and month",
        });
      }

      // ============================================================
      // 🔥 CALL FUNCTION TO ALSO UPDATE expense_payments
      // ============================================================
      if (paid === "Yes") {
        updateExpensePaymentOnSalaryPaid(employeeId, month, paidAmount, paidDate);
      }

      return res.json({
        success: true,
        message: "Salary updated successfully",
      });
    }
  );
});


// ==============================================================
// ⭐ Helper Function to update expense_payments based on salary
// ==============================================================
function updateExpensePaymentOnSalaryPaid(employeeId, month_year, paidAmount, paidDate) {
  console.log("🔄 Updating expense_payments for salary payment...");

  // 1️⃣ Get employee name
  const empQuery = `SELECT employee_name FROM salary_payments WHERE employee_id = ?`;

  db.get(empQuery, [employeeId], (err, emp) => {
    if (err || !emp) {
      return console.error("❌ Employee not found in salary_payments.");
    }

    // Build type string
    const typeString = `Salary - ${emp.employee_name} (${employeeId})`;

    // 2️⃣ Get expense_id from expenses table
    const expQuery = `SELECT auto_id FROM expenses WHERE type = ?`;

    db.get(expQuery, [typeString], (err, expense) => {
      if (err || !expense) {
        return console.error("❌ No expense entry found for:", typeString);
      }

      const expenseId = expense.auto_id;

      // 3️⃣ Update expense_payments entry
      const updateExpensePayment = `
        UPDATE expense_payments
        SET 
          paid_amount = ?, 
          paid_date = ?, 
          status = 'Paid'
        WHERE expense_id = ? AND month_year = ?
      `;

      db.run(
        updateExpensePayment,
        [paidAmount, paidDate, expenseId, month_year],
        function (err) {
          if (err) {
            return console.error("❌ Error updating expense_payments:", err);
          }

          if (this.changes === 0) {
            console.log("⚠️ No existing expense_payments found. Ignoring.");
          } else {
            console.log("✅ expense_payments updated successfully.");
          }
        }
      );
    });
  });
}





// ✅ Pay Expense and Record Transaction
// ✅ Pay Expense and Record Transaction (with account deduction)
// app.put("/pay-expense", (req, res) => {
//   const { expense_id, paid_amount, paid_date } = req.body;

//   if (!expense_id || !paid_amount || !paid_date) {
//     return res.status(400).json({ success: false, message: "Missing fields" });
//   }

//   const amount = parseFloat(paid_amount);

//   // ✔ Use YYYY-MM format
//   const paidMonthYear = paid_date.slice(0, 7); // "2025-11"

//   // Generate 4-digit time code (HHMM)
//   const now = new Date();
//   const timeCode = `${now.getHours().toString().padStart(2, "0")}${now
//     .getMinutes()
//     .toString()
//     .padStart(2, "0")}`;

//   // 1️⃣ Get Expense details
//   db.get(`SELECT * FROM expenses WHERE auto_id = ?`, [expense_id], (err, expense) => {
//     if (err) return res.status(500).json({ success: false, message: err.message });
//     if (!expense) return res.status(404).json({ success: false, message: "Expense not found" });

//     const expenseType = expense.type || expense.description || "General";
//     const isRegular = expense.regular === "Yes" ? "Regular" : "NonReg";
//     const transactionId = `DEB|${isRegular}|${expenseType}|${paidMonthYear}|${timeCode}`;
//     const description = `Expense paid for ${expenseType} of month ${paidMonthYear}`;

//     // 2️⃣ Get Current Account
//     db.get(`SELECT * FROM accounts WHERE account_type = 'Current'`, (err, currentAcc) => {
//       if (err || !currentAcc) {
//         return res.status(500).json({ success: false, message: "Current account not found" });
//       }

//       if (currentAcc.balance < amount) {
//         return res.status(400).json({
//           success: false,
//           message: `Insufficient funds. Current balance: ₹${currentAcc.balance} — required: ₹${amount}`,
//         });
//       }

//       const prevBalance = currentAcc.balance;
//       const newBalance = prevBalance - amount;

//       db.serialize(() => {
//         // 💰 Update Current Account
//         db.run(
//           `UPDATE accounts SET balance = ? WHERE account_id = ?`,
//           [newBalance, currentAcc.account_id]
//         );

//         // 📒 Record debit transaction
//         db.run(
//           `
//           INSERT INTO transactions 
//             (transaction_id, account_number, type, amount, description, previous_balance, updated_balance, created_at)
//           VALUES (?, ?, 'Debit', ?, ?, ?, ?, datetime('now'))
//           `,
//           [
//             transactionId,
//             currentAcc.account_number,
//             amount,
//             description,
//             prevBalance,
//             newBalance
//           ]
//         );

//         // 🧾 Insert OR update expense payment for that month
//         db.run(
//           `
//           INSERT INTO expense_payments (expense_id, month_year, actual_amount, paid_amount, paid_date, status)
//           VALUES (?, ?, ?, ?, ?, 'Paid')
//           ON CONFLICT(expense_id, month_year)
//           DO UPDATE SET 
//             paid_amount = excluded.paid_amount,
//             paid_date = excluded.paid_date,
//             status = 'Paid';
//           `,
//           [
//             expense_id,
//             paidMonthYear,
//             expense.amount, // actual amount
//             amount,
//             paid_date
//           ]
//         );

//         return res.json({
//           success: true,
//           message: `Expense paid successfully.`,
//           transaction_id: transactionId,
//           previous_balance: prevBalance,
//           updated_balance: newBalance,
//         });
//       });
//     });
//   });
// });

app.put("/pay-expense", (req, res) => {
  const { expense_id, paid_amount, paid_date } = req.body;

  if (!expense_id || !paid_amount || !paid_date) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  const amount = parseFloat(paid_amount);
  const paidMonthYear = paid_date.slice(0, 7);

  const now = new Date();
  const timeCode = `${now.getHours().toString().padStart(2, "0")}${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;

  // 1️⃣ Get Expense details
  db.get(
    `SELECT * FROM expenses WHERE auto_id = ?`,
    [expense_id],
    (err, expense) => {
      if (err) return res.status(500).json({ success: false, message: err.message });
      if (!expense)
        return res.status(404).json({ success: false, message: "Expense not found" });

      const expenseType = expense.type || expense.description || "General";
      const isRegular = expense.regular === "Yes" ? "Regular" : "NonReg";
      const transactionId = `DEB|${isRegular}|${expenseType}|${paidMonthYear}|${timeCode}`;
      const description = `Expense paid for ${expenseType} of month ${paidMonthYear}`;

      // 2️⃣ Get current account
      db.get(
        `SELECT * FROM accounts WHERE account_type = 'Current'`,
        (err, currentAcc) => {
          if (err || !currentAcc)
            return res
              .status(500)
              .json({ success: false, message: "Current account not found" });

          if (currentAcc.balance < amount) {
            return res.status(400).json({
              success: false,
              message: `Insufficient funds. Current balance: ₹${currentAcc.balance} — required: ₹${amount}`,
            });
          }

          const prevBalance = currentAcc.balance;
          const newBalance = prevBalance - amount;

          db.serialize(() => {
            // 💰 Update account balance
            db.run(
              `UPDATE accounts SET balance = ? WHERE account_id = ?`,
              [newBalance, currentAcc.account_id]
            );

            // 📒 Insert debit transaction
            db.run(
              `
              INSERT INTO transactions 
                (transaction_id, account_number, type, amount, description, previous_balance, updated_balance, created_at)
              VALUES (?, ?, 'Debit', ?, ?, ?, ?, datetime('now'))
            `,
              [
                transactionId,
                currentAcc.account_number,
                amount,
                description,
                prevBalance,
                newBalance,
              ]
            );

            // 🧾 Insert/Update expense_payments
            db.run(
              `
              INSERT INTO expense_payments (expense_id, month_year, actual_amount, paid_amount, paid_date, status)
              VALUES (?, ?, ?, ?, ?, 'Paid')
              ON CONFLICT(expense_id, month_year)
              DO UPDATE SET 
                paid_amount = excluded.paid_amount,
                paid_date = excluded.paid_date,
                status = 'Paid';
            `,
              [
                expense_id,
                paidMonthYear,
                expense.amount,
                amount,
                paid_date,
              ]
            );

            // ⭐ NEW: UPDATE monthly salary if this expense represents a salary
            updateSalaryOnExpensePaid(expenseType, paidMonthYear, amount, paid_date);

            return res.json({
              success: true,
              message: `Expense paid successfully.`,
              transaction_id: transactionId,
              previous_balance: prevBalance,
              updated_balance: newBalance,
            });
          });
        }
      );
    }
  );
});

function updateSalaryOnExpensePaid(expenseType, month_year, paidAmount, paidDate) {
  console.log("🔄 Salary update triggered from expense...");

  // 1️⃣ Check if it's salary expense
  if (!/salary/i.test(expenseType)) {
    console.log("⏭ Not a salary expense. Skipping.");
    return;
  }

  // 2️⃣ Extract employee name and ID
  let cleaned = expenseType.replace(/salary\s*[-:]?\s*/i, "").trim();
  const employeeName = cleaned.replace(/\([^)]*\)/g, "").trim();

  const idMatch = expenseType.match(/\(([^)]+)\)/);
  if (!idMatch) {
    console.log("❌ Could not extract employee ID");
    return;
  }

  const employeeId = idMatch[1];

  console.log("👤 Employee Name:", employeeName);
  console.log("🆔 Employee ID:", employeeId);

  // 3️⃣ Extract month (YYYY-MM)
  const targetMonth = month_year.slice(0, 7);

  // 4️⃣ Update the monthly salary payment
  const salaryUpdateQuery = `
    UPDATE monthly_salary_payments
    SET 
      paid = 'Yes',
      paid_amount = ?, 
      actual_to_pay = ?, 
      paid_date = ?
    WHERE employee_id = ?
      AND substr(month, 1, 7) = ?
  `;

  db.run(
    salaryUpdateQuery,
    [paidAmount, paidAmount, paidDate, employeeId, targetMonth],
    function (err) {
      if (err) {
        console.error("❌ Error updating monthly salary:", err);
        return;
      }

      if (this.changes === 0) {
        console.log(`⚠️ No matching salary record for ${employeeId} in ${targetMonth}`);
      } else {
        console.log("✅ Monthly salary updated to Paid ✔");
      }
    }
  );
}



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


// app.get("/getexpenses", (req, res) => {
//   const { month } = req.query; // format: "YYYY-MM"
//   if (!month) return res.status(400).json({ error: "Month is required (YYYY-MM)" });

//   const selectedYear = parseInt(month.split("-")[0]);
//   const selectedMonth = parseInt(month.split("-")[1]);

//   // 🗓️ Convert "YYYY-MM" → "Nov 2025"
//   const date = new Date(`${month}-01`);
//   const formattedMonth = date.toLocaleString("default", { month: "short", year: "numeric" });

//   const sql = `
//     SELECT 
//       e.auto_id,
//       e.regular,
//       e.type,
//       e.description,
//       e.amount,
//       e.currency,
//       e.raised_date,
//       e.due_date,
//       e.status AS expense_status,
//       ep.paid_amount,
//       ep.paid_date,
//       ep.status AS payment_status
//     FROM expenses e
//     LEFT JOIN expense_payments ep
//       ON e.auto_id = ep.expense_id AND ep.month_year = ?
//     ORDER BY e.auto_id DESC
//   `;

//   db.all(sql, [formattedMonth], (err, rows) => {
//     if (err) {
//       console.error("DB Query Error:", err.message);
//       return res.status(500).json({ error: err.message });
//     }

//     const filtered = rows.filter(row => {
//       const raised = new Date(row.raised_date);
//       const raisedYear = raised.getFullYear();
//       const raisedMonth = raised.getMonth() + 1;

//       if (row.regular === "Yes") {
//         return (
//           selectedYear > raisedYear ||
//           (selectedYear === raisedYear && selectedMonth >= raisedMonth)
//         );
//       } else {
//         return selectedYear === raisedYear && selectedMonth === raisedMonth;
//       }
//     });

//     const formatted = filtered.map(row => ({
//       id: `E${row.auto_id}`,
//       regular: row.regular,
//       type: row.type,
//       description: row.description,
//       amount: row.amount,
//       currency: row.currency,
//       raised_date: row.raised_date,
//       due_date: row.due_date,
//       paid_amount: row.paid_amount || 0,
//       paid_date: row.paid_date || "Not Paid",
//       paymentstatus: row.payment_status || "Pending",
//       expensestatus: row.expense_status || "Raised",
//     }));

//     res.json(formatted);
//     console.log(formatted);
//   });
// });

app.get("/getexpenses", (req, res) => {
  const { month } = req.query; 
  if (!month) return res.status(400).json({ error: "Month is required (YYYY-MM)" });

  const [selectedYear, selectedMonth] = month.split("-").map(Number);

  const sql = `
    SELECT 
      e.auto_id,
      e.regular,
      e.type,
      e.description,
      e.amount,
      e.currency,
      e.raised_date,
      e.due_date AS expense_due_date,
      e.status AS expense_status,

      ep.actual_amount,
      ep.paid_amount,
      ep.paid_date,
      ep.status AS payment_status,
      ep.due_date AS payment_due_date,
      ep.month_year

    FROM expenses e
    LEFT JOIN expense_payments ep
      ON e.auto_id = ep.expense_id
      AND ep.month_year = ?
    ORDER BY e.auto_id DESC
  `;

  db.all(sql, [month], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const filtered = rows.filter(row => {
      const [rYear, rMonth] = row.raised_date.split("-").map(Number);
      const paymentExists = row.actual_amount !== null && row.actual_amount !== undefined;

      if (paymentExists) return true;

      if (row.regular === "Yes") {
        return (
          selectedYear > rYear ||
          (selectedYear === rYear && selectedMonth >= rMonth)
        );
      }

      return rYear === selectedYear && rMonth === selectedMonth;
    });

    const formatted = filtered.map(row => ({
      id: `E${row.auto_id}`,
      regular: row.regular,
      type: row.type,
      description: row.description,
      amount: row.amount,
      actual_to_pay: row.actual_amount,
      paid_amount: row.paid_amount,
      raised_date: row.raised_date,
      due_date: row.payment_due_date || row.expense_due_date,
      paid_date: row.paid_date || "Not Paid",
      paymentstatus: row.payment_status || "Pending",
      expensestatus: row.expense_status || "Raised",
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

// ✅ Get pending salaries summary

app.get("/api/pending-salaries", (req, res) => {

  const sql =     `SELECT 

      employee_id,

      employee_name,
      paid,
      actual_to_pay,
      

      COUNT(month) AS pending_months_count,

      GROUP_CONCAT(month, ', ') AS pending_months

    FROM monthly_salary_payments

    WHERE paid = 'No'

    GROUP BY employee_id, employee_name

    ORDER BY employee_name;`
;

  db.all(sql, [], (err, rows) => {

    if (err) {

      console.error("Error fetching pending salaries:", err);

      res.status(500).json({ success: false, message: "Database error" });

    } else {

      res.json({ success: true, data: rows });

      console.log(rows)

    }

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


// 🔹 Create Account
app.post("/accounts", (req, res) => {
  const { account_number, account_name, account_type, balance } = req.body;
  db.run(
    `INSERT INTO accounts (account_number, account_name, account_type, balance)
     VALUES (?, ?, ?, ?)`,
    [account_number, account_name, account_type, balance || 0],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      res.json({ id: this.lastID, message: "Account created" });
    }
  );
});

// 🔹 Get Transaction History (Joined)
app.get("/transactionsOfBankAccounts", (req, res) => {
  const { account_number } = req.query;

  if (!account_number) {
    return res.status(400).json({ error: "Account number is required" });
  }

  db.all(
    `
    SELECT 
      transaction_id,
      account_number,
      type,
      description,
      amount,
      previous_balance,
      updated_balance,
      created_at
    FROM transactions
    WHERE account_number = ?
    ORDER BY datetime(created_at) DESC
    `,
    [account_number],
    (err, rows) => {
      if (err) {
        console.error("Error fetching transactions:", err);
        return res.status(500).json({ error: "Database error" });
      }
      res.json(rows);
    }
  );
});

// 🔹 Create Account
app.post("/accounts", (req, res) => {
  const { account_number, account_name, account_type, balance } = req.body;
  db.run(
    `INSERT INTO accounts (account_number, account_name, account_type, balance)
     VALUES (?, ?, ?, ?)`,
    [account_number, account_name, account_type, balance || 0],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      res.json({ id: this.lastID, message: "Account created" });
    }
  );
});

// 🔹 Get All Accounts
app.get("/accounts", (req, res) => {
  db.all(`SELECT * FROM accounts`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 🔹 Hide / Unhide Account
app.patch("/accounts/:id/hide", (req, res) => {
  const { hide } = req.body;
  db.run(`UPDATE accounts SET is_hidden = ? WHERE account_id = ?`, [hide, req.params.id], (err) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json({ message: hide ? "Hidden" : "Visible" });
  });
});

// 🔹 Get Account Balance
app.get("/accounts/:number/balance", (req, res) => {
  db.get(`SELECT balance FROM accounts WHERE account_number = ?`, [req.params.number], (err, row) => {
    if (err || !row) return res.status(404).json({ error: "Not found" });
    res.json({ account_number: req.params.number, balance: row.balance });
  });
});

// 🔹 Add Transaction (auto-linked)
app.post("/transactions", (req, res) => {
  const { account_number, amount, description, related_module, related_id } = req.body;
  let type;

  if (related_module === "Invoice") type = "Incoming";
  else if (related_module === "Salary" || related_module === "Expense") type = "Outgoing";
  else type = "Transfer";

  const currentAcc = account_number;
  const capitalAcc = "CAP-001"; // Change to your actual capital account number

  if (type === "Outgoing") {
    autoTransferIfInsufficient(db, currentAcc, capitalAcc, amount, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      handleTransaction();
    });
  } else {
    handleTransaction();
  }

  function handleTransaction() {
    db.serialize(() => {
      if (type === "Incoming")
        db.run(`UPDATE accounts SET balance = balance + ? WHERE account_number = ?`, [amount, currentAcc]);
      else if (type === "Outgoing")
        db.run(`UPDATE accounts SET balance = balance - ? WHERE account_number = ?`, [amount, currentAcc]);

      db.run(
        `INSERT INTO transactions (account_number, type, description, amount, related_module, related_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [currentAcc, type, description, amount, related_module, related_id],
        function (err) {
          if (err) return res.status(400).json({ error: err.message });

          // Update related table
          if (related_module === "Salary") {
            db.run(`UPDATE monthly_salary_payments SET paid='Yes', paid_amount=?, paid_date=date('now') WHERE id=?`, [amount, related_id]);
          } else if (related_module === "Expense") {
            db.run(`UPDATE expense_payments SET status='Paid', paid_amount=?, paid_date=date('now') WHERE id=?`, [amount, related_id]);
          } else if (related_module === "Invoice") {
            db.run(`UPDATE invoices SET received='Yes', received_date=date('now') WHERE id=?`, [related_id]);
          }

          res.json({ message: "Transaction recorded", transaction_id: this.lastID });
        }
      );
    });
  }
});

// 🔹 Get Transaction History (Joined)
app.get("/transactions", (req, res) => {
  db.all(
    `
    SELECT t.transaction_id, t.account_number, t.type, t.amount, t.description,
           t.related_module, t.related_id, t.created_at,
           CASE
             WHEN t.related_module = 'Salary' THEN s.employee_name
             WHEN t.related_module = 'Expense' THEN e.type
             WHEN t.related_module = 'Invoice' THEN i.client_name
           END AS related_party
    FROM transactions t
    LEFT JOIN monthly_salary_payments s ON t.related_id = s.id AND t.related_module = 'Salary'
    LEFT JOIN expenses e ON t.related_id = e.auto_id AND t.related_module = 'Expense'
    LEFT JOIN invoices i ON t.related_id = i.id AND t.related_module = 'Invoice'
    ORDER BY t.created_at DESC
    `,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});



// ✅ Create Account API
app.post("/accounts", (req, res) => {
  const { account_number, account_name, account_type, balance } = req.body;

  // Validate input
  if (!account_number || !account_name || !account_type) {
    return res.status(400).json({ error: "All fields are required" });
  }

  if (!["Capital", "Current"].includes(account_type)) {
    return res.status(400).json({ error: "Invalid account type" });
  }

  // Insert into DB
  const sql = `
    INSERT INTO accounts (account_number, account_name, account_type, balance)
    VALUES (?, ?, ?, ?)
  `;

  db.run(sql, [account_number, account_name, account_type, balance || 0], function (err) {
    if (err) {
      if (err.message.includes("UNIQUE constraint")) {
        return res.status(400).json({ error: "Account number already exists" });
      }
      return res.status(500).json({ error: err.message });
    }

    // Respond success
    res.status(201).json({
      message: "✅ Account created successfully",
      account: {
        account_id: this.lastID,
        account_number,
        account_name,
        account_type,
        balance: balance || 0,
      },
    });
  });
});

// ✅ Create Account API
app.post("/accounts", (req, res) => {
  const { account_number, account_name, account_type, balance } = req.body;

  // Validate input
  if (!account_number || !account_name || !account_type) {
    return res.status(400).json({ error: "All fields are required" });
  }

  if (!["Capital", "Current"].includes(account_type)) {
    return res.status(400).json({ error: "Invalid account type" });
  }

  // Insert into DB
  const sql = `
    INSERT INTO accounts (account_number, account_name, account_type, balance)
    VALUES (?, ?, ?, ?)
  `;

  db.run(sql, [account_number, account_name, account_type, balance || 0], function (err) {
    if (err) {
      if (err.message.includes("UNIQUE constraint")) {
        return res.status(400).json({ error: "Account number already exists" });
      }
      return res.status(500).json({ error: err.message });
    }

    // Respond success
    res.status(201).json({
      message: "✅ Account created successfully",
      account: {
        account_id: this.lastID,
        account_number,
        account_name,
        account_type,
        balance: balance || 0,
      },
    });
  });
});

// PATCH: Add balance
app.patch("/accounts/:number/add-balance", (req, res) => {
  const { amount } = req.body;
  const { number } = req.params;

  if (!amount || amount <= 0)
    return res.status(400).json({ error: "Invalid amount" });

  db.run(
    `UPDATE accounts SET balance = balance + ? WHERE account_number = ?`,
    [amount, number],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Account not found" });
      res.json({ message: "Balance updated successfully" });
    }
  );
});
// 🔹 Transfer money between accounts
app.post("/accounts/transfer", (req, res) => {
  const { from_account, to_account, amount, description } = req.body;

  if (!from_account || !to_account || !amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid transfer details" });
  }

  if (from_account === to_account) {
    return res.status(400).json({ error: "Cannot transfer to the same account" });
  }});

// PATCH: Add balance
app.patch("/accounts/:number/add-balance", (req, res) => {
  const { amount } = req.body;
  const { number } = req.params;

  if (!amount || amount <= 0)
    return res.status(400).json({ error: "Invalid amount" });

  db.run(
    `UPDATE accounts SET balance = balance + ? WHERE account_number = ?`,
    [amount, number],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Account not found" });
      res.json({ message: "Balance updated successfully" });
    }
  );
});

// 🔹 Transfer money between accounts
app.post("/accounts/transfer", (req, res) => {
  const { from_account, to_account, amount, description } = req.body;

  if (!from_account || !to_account || !amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid transfer details" });
  }

  if (from_account === to_account) {
    return res.status(400).json({ error: "Cannot transfer to the same account" });
  }

  db.serialize(() => {
    // 1️⃣ Check balance of sender
    db.get(
      `SELECT balance FROM accounts WHERE account_number = ?`,
      [from_account],
      (err, sender) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!sender) return res.status(404).json({ error: "Sender not found" });

        if (sender.balance < amount) {
          return res.status(400).json({ error: "Insufficient balance" });
        }

        // 2️⃣ Deduct from sender
        db.run(
          `UPDATE accounts SET balance = balance - ? WHERE account_number = ?`,
          [amount, from_account],
          function (err) {
            if (err) return res.status(500).json({ error: err.message });

            // 3️⃣ Add to receiver
            db.run(
              `UPDATE accounts SET balance = balance + ? WHERE account_number = ?`,
              [amount, to_account],
              function (err) {
                if (err) return res.status(500).json({ error: err.message });

                // 4️⃣ Record in transactions table for both
                const desc = description || `Transfer from ${from_account} to ${to_account}`;
                const now = new Date().toISOString();

                const stmt = db.prepare(`
                  INSERT INTO transactions (account_number, type, description, amount, related_module, created_at)
                  VALUES (?, ?, ?, ?, 'Transfer', ?)
                `);

                stmt.run(from_account, "Outgoing", desc, amount, now);
                stmt.run(to_account, "Incoming", desc, amount, now);
                stmt.finalize();

                res.json({
                  message: "✅ Transfer successful",
                  details: { from_account, to_account, amount },
                });
              }
            );
          }
        );
      }
    );
  });
});

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------
function runQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error("❌ SQL Error:", err.message, "\nQuery:", sql);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

function monthKey(dateStr) {
  if (!dateStr) return null;
  return dateStr.slice(0, 7); // YYYY-MM
}




// app.get("/forecast", async (req, res) => {
//   try {
//     const db = req.app.locals.db;
//     if (!db) throw new Error("Database not initialized");

//     const runQuery = (sql, params = []) =>
//       new Promise((resolve, reject) =>
//         db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
//       );

//     const today = new Date();
//     const startYear = today.getFullYear();
//     const endYear = today.getFullYear() + 2;

//     const generateMonthRange = (start, end) => {
//       const result = [];
//       const [sy, sm] = start.split("-").map(Number);
//       const [ey, em] = end.split("-").map(Number);
//       let y = sy, m = sm;
//       while (y < ey || (y === ey && m <= em)) {
//         result.push(`${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}`);
//         m++;
//         if (m === 13) { m = 1; y++; }
//       }
//       return result;
//     };

//     const monthKeys = generateMonthRange(`${startYear}-01`, `${endYear}-12`);

//     // fetch data
//     const projects = await runQuery(
//       `SELECT projectID, projectName, startDate, endDate, netPayable, invoiceCycle, active
//        FROM Projects`
//     );

//     const invoices = await runQuery(
//       `SELECT id, invoice_number, project_id, invoice_value, gst_amount, due_date, received
//        FROM invoices WHERE due_date IS NOT NULL`
//     );

//     const actualReceivedInvoices = await runQuery(
//       `SELECT id, invoice_number, project_id, invoice_value, gst_amount, received_date
//        FROM invoices WHERE received = 'Yes' AND received_date IS NOT NULL`
//     );

//     const allExpenses = await runQuery(
//       `SELECT auto_id, regular, type, description, amount, raised_date, due_date
//        FROM expenses WHERE raised_date IS NOT NULL`
//     );

//     const expensePayments = await runQuery(
//   `SELECT
//      ep.id,
//      ep.expense_id,
//      ep.month_year,
//      ep.actual_amount AS actual_amount,
//      ep.paid_amount AS paid_amount,
//      ep.paid_date AS paid_date,
//      ep.status AS status,
//      e.regular AS regular,
//      e.type AS expense_type,
//      e.description AS expense_description,
//      e.amount AS base_amount
//    FROM expense_payments ep
//    LEFT JOIN expenses e ON e.auto_id = ep.expense_id`
// );


//     // --- ADD: map expenses by id for due_date lookup later ---
//     const expensesById = {};
//     allExpenses.forEach(e => {
//       expensesById[e.auto_id] = e;
//     });

//     // maps
//     const invoicesByDueMonth = {};
//     invoices.forEach(inv => {
//       const m = inv.due_date?.slice(0, 7);
//       if (m) (invoicesByDueMonth[m] ||= []).push(inv);
//     });

//     const actualReceivedByMonth = {};
//     actualReceivedInvoices.forEach(inv => {
//       const m = inv.received_date?.slice(0, 7);
//       if (m) (actualReceivedByMonth[m] ||= []).push(inv);
//     });

//     const paidExpensesByMonth = {};
//     expensePayments.forEach(ep => {
//       const m = ep.paid_date?.slice(0, 7) || ep.month_year?.slice(0, 7);
//       if (m) (paidExpensesByMonth[m] ||= []).push(ep);
//     });

//     // const paymentsByExpenseId = {};
//     // expensePayments.forEach(p => {
//     //   (paymentsByExpenseId[p.expense_id] ||= []).push(p);
//     // });
//     const paymentsByExpenseId = {};
// expensePayments.forEach(raw => {
//   const p = {
//     ...raw,
//     // coerce numbers and normalize null -> undefined for easier checks
//     paid_amount: raw.paid_amount != null ? Number(raw.paid_amount) : (raw.actual_amount != null ? Number(raw.actual_amount) : null),
//     actual_amount: raw.actual_amount != null ? Number(raw.actual_amount) : null,
//     month_year: raw.month_year || null,
//     paid_date: raw.paid_date || null,
//     status: raw.status || null,
//   };
//   (paymentsByExpenseId[p.expense_id] ||= []).push(p);
// });


//     const normalizeRegular = val => {
//       if (val === null || val === undefined) return "No";
//       const s = String(val).trim().toLowerCase();
//       return ["yes", "y", "true", "1"].includes(s) ? "Yes" : "No";
//     };

//     // const getLatestPayment = (expenseId) => {
//     //   const list = paymentsByExpenseId[expenseId] || [];
//     //   if (!list.length) return null;
//     //   const paidFirst = list.find(p => String(p.status).toLowerCase() === "paid");
//     //   if (paidFirst) return paidFirst;
//     //   return [...list].sort((a, b) => {
//     //     const da = a.paid_date ? new Date(a.paid_date) : (a.month_year ? new Date(a.month_year + "-01") : new Date(0));
//     //     const db = b.paid_date ? new Date(b.paid_date) : (b.month_year ? new Date(b.month_year + "-01") : new Date(0));
//     //     return db - da;
//     //   })[0];
//     // };

//     const getLatestPayment = (expenseId) => {
//   const list = paymentsByExpenseId[expenseId] || [];
//   if (!list.length) return null;

//   // prefer a payment that is explicitly Paid
//   const paidFirst = list.find(p => String(p.status || "").toLowerCase() === "paid");
//   if (paidFirst) {
//     return {
//       ...paidFirst,
//       paid_amount: paidFirst.paid_amount != null ? Number(paidFirst.paid_amount) : (paidFirst.actual_amount != null ? Number(paidFirst.actual_amount) : 0),
//       paid_date: paidFirst.paid_date || null,
//     };
//   }

//   // else take the latest by paid_date or month_year
//   const sorted = [...list].sort((a, b) => {
//     const da = a.paid_date ? new Date(a.paid_date) : (a.month_year ? new Date(a.month_year + "-01") : new Date(0));
//     const db = b.paid_date ? new Date(b.paid_date) : (b.month_year ? new Date(b.month_year + "-01") : new Date(0));
//     return db - da;
//   });

//   const latest = sorted[0];
//   return {
//     ...latest,
//     paid_amount: latest.paid_amount != null ? Number(latest.paid_amount) : (latest.actual_amount != null ? Number(latest.actual_amount) : 0),
//     paid_date: latest.paid_date || null,
//   };
// };

    
//     const regularExpenses = allExpenses.filter(e => normalizeRegular(e.regular) === "Yes");
//     const oneTimeExpenses = allExpenses.filter(e => normalizeRegular(e.regular) === "No");

//     const months = [];

//     for (const monthKey of monthKeys) {
//       const forecastExpenseItems = [];

//       // Helper to convert monthKey -> ISO day for effective_due_date
//       const monthKeyToFirstDay = (mk) => `${mk}-01`;

//       // A) Regular recurring expenses — appear each month if started
//       regularExpenses.forEach(exp => {
//         const start = exp.raised_date?.slice(0, 7) || exp.due_date?.slice(0, 7);
//         if (start && start <= monthKey) {
//           const latest = getLatestPayment(exp.auto_id);
//           forecastExpenseItems.push({
//             expense_id: exp.auto_id,
//             type: exp.type,
//             description: exp.description,
//             amount: Number(exp.amount),
//             regular: normalizeRegular(exp.regular),
//             original_due_date: exp.due_date || null,                 // <-- original stored due_date
//             effective_due_date: exp.due_date ? exp.due_date : monthKeyToFirstDay(monthKey), // <-- what UI should display for this row
//             due_date: exp.due_date,
//             paid_amount: latest ? (latest.paid_amount != null ? Number(latest.paid_amount) : Number(latest.actual_amount || 0)) : 0,
//             paid_date: latest ? latest.paid_date || null : null,
//             status: latest ? (latest.status || "Paid") : "Unpaid",
//           });
//         }
//       });

//       // B) One-time expenses — carry forward until Paid
//       oneTimeExpenses.forEach(exp => {
//         const start = exp.due_date?.slice(0, 7) || exp.raised_date?.slice(0, 7);
//         if (!start) return;
//         if (start <= monthKey) {
//           const latest = getLatestPayment(exp.auto_id);
//           const isPaid = latest && String(latest.status).toLowerCase() === "paid";
//           if (!isPaid) {
//             forecastExpenseItems.push({
//               expense_id: exp.auto_id,
//               type: exp.type,
//               description: exp.description,
//               amount: Number(exp.amount),
//               regular: normalizeRegular(exp.regular),
//               original_due_date: exp.due_date || null,                    // original due_date from expenses table
//               effective_due_date: monthKeyToFirstDay(monthKey),           // carry-forward: show this month as due
//               due_date: exp.due_date,
//               paid_amount: latest ? (latest.paid_amount != null ? Number(latest.paid_amount) : Number(latest.actual_amount || 0)) : 0,
//               paid_date: latest ? latest.paid_date || null : null,
//               status: latest ? (latest.status || "Unpaid") : "Unpaid",
//             });
//           }
//         }
//       });

//       // C) Actual paid expense rows for this month
//       // <-- REPLACED: include due_date (from expenses table when available) and paid_amount
//       const actualExpenseItems =
//         (paidExpensesByMonth[monthKey] || []).map(ep => {
//           const paidAmount = ep.paid_amount != null
//             ? Number(ep.paid_amount)
//             : (ep.actual_amount != null ? Number(ep.actual_amount) : Number(ep.base_amount || 0));

//           const original = expensesById[ep.expense_id] || null;
//           const dueDate = original ? original.due_date : (ep.due_date || null);

//           return {
//             expense_id: ep.expense_id,
//             expense_type: ep.expense_type,
//             description: ep.expense_description,
//             amount: paidAmount,
//             paid_amount: paidAmount,
//             actual_amount: ep.actual_amount != null ? Number(ep.actual_amount) : null,
//             due_date: dueDate || null,     // <-- due_date from expenses table (preferred)
//             paid_date: ep.paid_date || null,
//             regular: normalizeRegular(ep.regular),
//             status: ep.status || "Paid",
//           };
//         });

//       const actualExpenseTotal = actualExpenseItems.reduce((s, a) => s + a.amount, 0);
//       const forecastExpenseTotal = forecastExpenseItems.reduce((s, a) => s + Number(a.paid_amount || a.amount || 0), 0);

//       // Income actual/forecast same as before
//       const actualIncomeItems =
//         (actualReceivedByMonth[monthKey] || []).map(inv => ({
//           invoice_id: inv.id,
//           invoice_number: inv.invoice_number,
//           project_id: inv.project_id,
//           invoice_value: Number(inv.invoice_value),
//           total_with_gst: Number(inv.invoice_value),
//           gst_amount: Number(inv.gst_amount || 0),
//           received_date: inv.received_date,
//         })) || [];

//       const actualIncomeTotal = actualIncomeItems.reduce((s, a) => s + a.total_with_gst, 0);

//       const forecastIncomeItems = (invoicesByDueMonth[monthKey] || []).map(inv => ({
//         invoice_id: inv.id,
//         invoice_number: inv.invoice_number,
//         project_id: inv.project_id,
//         invoice_value: Number(inv.invoice_value),
//         total_with_gst: Number(inv.invoice_value),
//         gst_amount: Number(inv.gst_amount || 0),
//         due_date: inv.due_date,
//       }));

//       // project-based forecasts (unchanged)...
//       projects.forEach((p) => {
//         const netPayable = Number(p.netPayable || p.net_payable || 0);
//         if (!netPayable || netPayable <= 0) return;
//         const startMonth = p.startDate ? String(p.startDate).slice(0, 7) : null;
//         const endMonth = p.endDate ? String(p.endDate).slice(0, 7) : null;
//         if (startMonth && monthKey < startMonth) return;
//         if (endMonth && monthKey > endMonth) return;
//         const cycle = String(p.invoiceCycle || "Monthly").toLowerCase();
//         if (cycle === "quarterly" && startMonth) {
//           const [sy, sm] = startMonth.split("-").map(Number);
//           const [cy, cm] = monthKey.split("-").map(Number);
//           const diff = (cy - sy) * 12 + (cm - sm);
//           if (diff % 3 !== 0) return;
//         }
//         const invoiceExists = (invoicesByDueMonth[monthKey] || []).some(inv => inv.project_id === p.projectID);
//         if (invoiceExists) return;
//         forecastIncomeItems.push({
//           project_id: p.projectID,
//           projectName: p.projectName,
//           invoice_value: netPayable,
//           total_with_gst: netPayable,
//           gst_amount: 0,
//           note: "project forecast",
//         });
//       });

//       const forecastIncomeTotal = forecastIncomeItems.reduce((s, a) => s + Number(a.total_with_gst || a.invoice_value || a.amount || 0), 0);

//       months.push({
//         month: monthKey,
//         actualIncomeTotal,
//         actualIncomeItems,
//         forecastIncomeTotal,
//         forecastIncomeItems,
//         actualExpenseTotal,
//         actualExpenseItems,
//         forecastExpenseTotal,
//         forecastExpenseItems,
//         monthlyBalance: forecastIncomeTotal - forecastExpenseTotal,
//       });
//     }

//     return res.json({
//       success: true,
//       message: "Forecast generated successfully",
//       months,
//     });
//   } catch (err) {
//     console.error("❌ Forecast Error:", err);
//     return res.status(500).json({ success: false, message: err.message });
//   }
// });



app.get("/forecast", async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) throw new Error("Database not initialized");

    const runQuery = (sql, params = []) =>
      new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
      );

    const today = new Date();

    // generate months from startYear-01 to endYear-12 (2 years ahead by default)
    const startYear = today.getFullYear();
    const endYear = today.getFullYear() + 2;

    const generateMonthRange = (start, end) => {
      // start/end in "YYYY-MM"
      const result = [];
      const [sy, sm] = start.split("-").map(Number);
      const [ey, em] = end.split("-").map(Number);

      let y = sy;
      let m = sm;
      while (y < ey || (y === ey && m <= em)) {
        result.push(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`);
        m++;
        if (m === 13) {
          m = 1;
          y++;
        }
      }
      return result;
    };

    const monthKeys = generateMonthRange(`${startYear}-01`, `${endYear}-12`);
    const startMonthDate = monthKeys[0] + "-01";
    const endMonthDate = monthKeys[monthKeys.length - 1] + "-31";

    // -------------------------
    // Raw data queries
    // -------------------------
    const projects = await runQuery(
      `SELECT projectID, projectName, startDate, endDate, netPayable, invoiceCycle, active FROM Projects`
    );

    const invoices = await runQuery(
      `SELECT id, invoice_number, project_id, invoice_value, gst_amount, due_date, received
       FROM invoices
       WHERE due_date IS NOT NULL
         AND date(due_date) BETWEEN date(?) AND date(?)`,
      [startMonthDate, endMonthDate]
    );

    const actualReceivedInvoices = await runQuery(
      `SELECT id, invoice_number, project_id, invoice_value, gst_amount, received_date
       FROM invoices
       WHERE received = 'Yes'
         AND received_date IS NOT NULL
         AND date(received_date) BETWEEN date(?) AND date(?)`,
      [startMonthDate, endMonthDate]
    );

    // expenses table (matches your schema)
    const allExpenses = await runQuery(
      `SELECT auto_id, regular, type, description, amount, raised_date, due_date, paid_date, paid_amount, status
       FROM expenses
       WHERE raised_date IS NOT NULL`
    );

    // expense_payments table (matches your schema). Join to get expense type/description for convenience.
    const expensePayments = await runQuery(
      `SELECT ep.id, ep.expense_id, ep.month_year, ep.actual_amount, ep.paid_amount, ep.paid_date, ep.status,
              e.type AS expense_type, e.description AS expense_description
       FROM expense_payments ep
       LEFT JOIN expenses e ON e.auto_id = ep.expense_id
       WHERE ep.status = 'Paid'
         AND ep.paid_date BETWEEN date(?) AND date(?)`,
      [startMonthDate, endMonthDate]
    );


    // -------------------------
    // Helper maps
    // -------------------------
    const invoicesByDueMonth = {};
    invoices.forEach((inv) => {
      const month = inv.due_date?.slice(0, 7);
      if (!month) return;
      (invoicesByDueMonth[month] ||= []).push(inv);
    });

    const actualReceivedByMonth = {};
    actualReceivedInvoices.forEach((inv) => {
      const month = inv.received_date?.slice(0, 7);
      if (!month) return;
      (actualReceivedByMonth[month] ||= []).push(inv);
    });

    const paidExpensesByMonth = {};
    expensePayments.forEach((ep) => {
      // use paid_date if available; fallback to month_year column if paid_date not present
      const month = ep.paid_date ? ep.paid_date.slice(0, 7) : (ep.month_year || "").slice(0, 7);
      if (!month) return;
      (paidExpensesByMonth[month] ||= []).push(ep);
    });

    const projectMap = {};
    projects.forEach((p) => (projectMap[p.projectID] = p));

    // -------------------------
    // Normalize regular flag
    // -------------------------
    const normalizeRegular = (val) => {
      if (val === null || val === undefined) return "no";
      // Accept 'Yes'/'No' or truthy values; normalize to 'yes' or 'no'
      const s = String(val).trim().toLowerCase();
      if (s === "yes" || s === "y" || s === "true" || s === "1") return "yes";
      return "no";
    };

    const regularExpenses = allExpenses.filter((e) => normalizeRegular(e.regular) === "yes");
    // const oneTimeExpenses = allExpenses.filter((e) => normalizeRegular(e.regular) === "no");

const paidExpenseIds = new Set(expensePayments.map((p) => p.expense_id));

const carryForwardMapInit = {};
 
// Only for REGULAR = "No"

const oneTimeExpenses = allExpenses.filter(exp => exp.regular === "No");
 
oneTimeExpenses.forEach((exp) => {

  const raisedMonth = exp.raised_date?.slice(0, 7);

  const dueMonth = exp.due_date?.slice(0, 7) || raisedMonth;
 
  // IF PAID → SHOW IN PAID MONTH WITH PAID AMOUNT

  if (paidExpenseIds.has(exp.auto_id)) {

    const payment = expensePayments.find(p => p.expense_id === exp.auto_id);

    const paidMonth = payment.paid_date?.slice(0, 7);
 
    if (paidMonth) {

      (carryForwardMapInit[paidMonth] ||= []).push({

        ...exp,

        status: "Paid",

        paid_amount: payment.paid_amount,   // <-- PAID AMOUNT HERE

        actual_amount: payment.actual_amount,

        paid_date: payment.paid_date,

        month_year: payment.month_year

      });

    }
 
    return; // PAID → STOP (don't carry forward)

  }
 
  // IF NOT PAID → CARRY FORWARD TO DUE MONTH

  const start = dueMonth || raisedMonth;

  if (start) {

    (carryForwardMapInit[start] ||= []).push({

      ...exp,

      status: "Unpaid",

      paid_amount: 0,     // unpaid → no paid amount

    });

  }

});

    // -------------------------
    // Build month-wise forecast
    // -------------------------
    const months = [];
    let pendingExpenses = [];

    for (const monthKey of monthKeys) {
      // bring forward carry-forward items into pending (avoid duplicates)
      if (carryForwardMapInit[monthKey]) {
        carryForwardMapInit[monthKey].forEach((exp) => {
          if (!pendingExpenses.some((p) => p.auto_id === exp.auto_id)) {
            pendingExpenses.push(exp);
          }
        });
      }

      // --- Actual Income ---
      const actualIncomeItems = (actualReceivedByMonth[monthKey] || []).map((inv) => ({
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        project_id: inv.project_id,
        invoice_value: Number(inv.invoice_value || 0),
        gst_amount: Number(inv.gst_amount || 0),
        total_with_gst: Number(inv.invoice_value || 0),
        received_date: inv.received_date,
      }));

      const actualIncomeTotal = actualIncomeItems.reduce((sum, it) => sum + it.total_with_gst, 0);

      // --- Forecast Income ---
      const forecastIncomeItems = [];

      // 1) Invoice overrides (due-date invoices)
      (invoicesByDueMonth[monthKey] || []).forEach((inv) => {
        forecastIncomeItems.push({
          invoice_id: inv.id,
          invoice_number: inv.invoice_number,
          project_id: inv.project_id,
          invoice_value: Number(inv.invoice_value || 0),
          gst_amount: Number(inv.gst_amount || 0),
          due_date: inv.due_date,
          project: projectMap[inv.project_id] || null,
          note: "invoice override",
        });
      });

      // 2) Project-based forecast
      projects.forEach((p) => {
        if (!p.startDate) return;

        const startMonth = p.startDate.slice(0, 7);
        const endMonth = p.endDate?.slice(0, 7);

        if (monthKey < startMonth) return;
        if (endMonth && monthKey > endMonth) return;

        const cycle = (p.invoiceCycle || "Monthly").toLowerCase();

        if (cycle === "quarterly") {
          const [sy, sm] = startMonth.split("-").map(Number);
          const [cy, cm] = monthKey.split("-").map(Number);
          const diff = (cy - sy) * 12 + (cm - sm);
          if (diff % 3 !== 0) return;
        }

        // Skip if an explicit invoice exists for this project/month
        const invoiceExists = (invoicesByDueMonth[monthKey] || []).some(
          (inv) => inv.project_id === p.projectID
        );
        if (invoiceExists) return;

        forecastIncomeItems.push({
          project_id: p.projectID,
          projectName: p.projectName,
          amount: Number(p.netPayable || 0),
          note: "project forecast",
        });
      });

      const forecastIncomeTotal = forecastIncomeItems.reduce(
        (sum, it) => sum + Number(it.invoice_value || it.amount || 0),
        0
      );

      // --- Actual Expenses ---
      const actualExpenseItems = (paidExpensesByMonth[monthKey] || []).map((ep) => ({
        expense_id: ep.expense_id,
        expense_type: ep.expense_type,
        description: ep.expense_description,
        amount: Number(ep.paid_amount || ep.actual_amount || 0),
        paid_date: ep.paid_date,
      }));

      const actualExpenseTotal = actualExpenseItems.reduce((sum, it) => sum + Number(it.amount || 0), 0);

      // --- Forecast Expenses (with duplicate prevention) ---
      const forecastExpenseItems = [];
      const monthAddedExpenseIds = new Set();

      // A) Regular expenses (recurring) - add per month if started
      regularExpenses.forEach((exp) => {
        const start = exp.raised_date?.slice(0, 7);
        if (start && start <= monthKey) {
          if (!monthAddedExpenseIds.has(exp.auto_id)) {
            monthAddedExpenseIds.add(exp.auto_id);
            forecastExpenseItems.push({
              expense_id: exp.auto_id,
              type: exp.type,
              description: exp.description,
              amount: Number(exp.amount || 0),
              due_date: exp.due_date,
              regular: exp.regular,
            });
          }
        }
      });

      // B) Carry-forward (pending) - unpaid one-time that became pending earlier
      if (pendingExpenses.length) {
        pendingExpenses.forEach((exp) => {
          if (!monthAddedExpenseIds.has(exp.auto_id)) {
            monthAddedExpenseIds.add(exp.auto_id);
            forecastExpenseItems.push({
              expense_id: exp.auto_id,
              type: exp.type,
              description: exp.description,
              amount: Number(exp.amount || 0),
              due_date: exp.due_date,
              note: "carry-forward",
            });
          }
        });
      }

      // C) One-time new unpaid due in this month
     // C) One-time unpaid expenses — filter ONLY by DUE DATE
oneTimeExpenses.forEach((exp) => {
  const d = exp.due_date?.slice(0, 7);

  // must have a due date month
  if (!d) return;

  const isPaid = expensePayments.some((p) => p.expense_id === exp.auto_id);

  // show only when due_date === current month AND not paid
  if (!isPaid && d === monthKey) {
    if (!monthAddedExpenseIds.has(exp.auto_id)) {
      monthAddedExpenseIds.add(exp.auto_id);
      forecastExpenseItems.push({
        expense_id: exp.auto_id,
        type: exp.type,
        description: exp.description,
        amount: Number(exp.amount || 0),
        due_date: exp.due_date,
      });
    }
  }
});


      const forecastExpenseTotal = forecastExpenseItems.reduce(
        (sum, it) => sum + Number(it.amount || 0),
        0
      );

      // --- Net Cash (you used forecastIncome - forecastExpense earlier; preserve logic)
      const monthlyBalance = forecastIncomeTotal - forecastExpenseTotal;

      // Build breakdowns (dedup-safe because we used monthAddedExpenseIds)
      const expenseBreakdown = {};
      [...actualExpenseItems, ...forecastExpenseItems].forEach((it) => {
        const key = it.type || it.expense_type || "Other";
        expenseBreakdown[key] = (expenseBreakdown[key] || 0) + Number(it.amount || 0);
      });

      const incomeBreakdown = {};
      [...actualIncomeItems, ...forecastIncomeItems].forEach((it) => {
        const key =
          it.projectName || (it.project && it.project.projectName) || it.project_id || "Other";
        const amt = Number(it.total_with_gst || it.invoice_value || it.amount || 0);
        incomeBreakdown[key] = (incomeBreakdown[key] || 0) + amt;
      });

      months.push({
        month: monthKey,
        actualIncomeTotal,
        actualIncomeItems,
        forecastIncomeTotal,
        forecastIncomeItems,
        actualExpenseTotal,
        actualExpenseItems,
        forecastExpenseTotal,
        forecastExpenseItems,
        monthlyBalance,
        incomeBreakdown,
        expenseBreakdown,
      });

      // Remove pending expenses that have become paid in this month (cleanup)
      pendingExpenses = pendingExpenses.filter(
        (exp) => !expensePayments.some((p) => p.expense_id === exp.auto_id)
      );
    } // end month loop

    return res.json({
      success: true,
      message: "Forecast generated successfully (schema-adapted)",
      startMonth: monthKeys[0],
      endMonth: monthKeys[monthKeys.length - 1],
      months,
      raw: {
        projects,
        invoices,
        actualReceivedInvoices,
        allExpenses,
        expensePayments,
      },
    });
  } catch (err) {
    console.error("❌ Forecast Error:", err);
    return res.status(500).json({ success: false, message: err.message, months: [] });
  }
});




// Getting monthly last balance for forecasting


// FULL UPDATED /forecast API (fixed paid-month detection & carry-forward)
// FULL UPDATED /forecast (fixed ym scoping + strict per-month paid detection)
// Paste/replace into server.js

// app.get("/forecast", async (req, res) => {
//   try {
//     const db = req.app.locals.db;
//     if (!db) throw new Error("Database not initialized");

//     const runQuery = (sql, params = []) =>
//       new Promise((resolve, reject) =>
//         db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
//       );

//     // ---------- helpers ----------
//     const generateMonthRange = (start, end) => {
//       const result = [];
//       const [sy, sm] = start.split("-").map(Number);
//       const [ey, em] = end.split("-").map(Number);
//       let y = sy, m = sm;
//       while (y < ey || (y === ey && m <= em)) {
//         result.push(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`);
//         m++;
//         if (m === 13) { m = 1; y++; }
//       }
//       return result;
//     };

//     const monthsBetweenInclusive = (startYM, endYM) => {
//       if (!startYM || !endYM) return [];
//       return generateMonthRange(startYM, endYM);
//     };

//     const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
//     const buildEffectiveDueDate = (ym, day) => {
//       const [yStr, mStr] = ym.split("-");
//       const y = Number(yStr);
//       const m = Number(mStr);
//       const last = daysInMonth(y, m);
//       const d = Math.min(Math.max(Number(day) || 1, 1), last);
//       return `${String(y).padStart(4,"0")}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
//     };

//     const parseTypeWithEmployee = (typeStr) => {
//       if (!typeStr || typeof typeStr !== "string") return { baseType: typeStr || "", employeeName: null, employeeCode: null };
//       const parts = typeStr.split(" - ");
//       const baseType = parts[0]?.trim() || "";
//       const rest = parts.slice(1).join(" - ").trim();
//       let employeeName = null, employeeCode = null;
//       if (rest) {
//         const m = rest.match(/^(.*)\s*\(([^)]+)\)\s*$/);
//         if (m) {
//           employeeName = m[1].trim();
//           employeeCode = m[2].trim();
//         } else {
//           employeeName = rest;
//         }
//       }
//       return { baseType, employeeName, employeeCode };
//     };

//     const normalizeEmpCode = (c) => (c ? String(c).replace(/\s+/g, "").toUpperCase() : null);
//     const isRegularYes = (exp) => String(exp.regular || "").trim().toLowerCase() === "yes";
//     const isSalaryType = (typeStr) => {
//       if (!typeStr) return false;
//       const t = String(typeStr).toLowerCase();
//       return t.startsWith("salary") || /\bsalary\b/.test(t);
//     };

//     // ---------- month range ----------
//     const today = new Date();
//     const startYear = today.getFullYear();
//     const endYear = today.getFullYear() + 2;
//     const monthKeys = generateMonthRange(`${startYear}-01`, `${endYear}-12`);

//     // ---------- fetch data ----------
//     const projects = await runQuery(
//       `SELECT projectID, projectName, startDate, endDate, netPayable, invoiceCycle, active FROM Projects`
//     );

//     const invoices = await runQuery(
//       `SELECT id, invoice_number, project_id, invoice_value, gst_amount, due_date, received, received_date
//        FROM invoices`
//     );

//     const allExpenses = await runQuery(
//       `SELECT auto_id, regular, type, description, amount, raised_date, due_date, paid_date, paid_amount, status
//        FROM expenses`
//     );

//     const expensePayments = await runQuery(
//       `SELECT id, expense_id, month_year, actual_amount, paid_amount, paid_date, status, due_date
//        FROM expense_payments`
//     );

//     const salaryPayments = await runQuery(
//       `SELECT id, employee_id, employee_name, paid, month, lop, paid_amount, actual_to_pay, paid_date, due_date
//        FROM monthly_salary_payments`
//     );

//     // ---------- build indexes ----------
//     const invoicesByDueMonth = {};
//     invoices.forEach(inv => {
//       const m = inv.due_date?.slice(0,7);
//       if (m) (invoicesByDueMonth[m] ||= []).push(inv);
//     });

//     const actualReceivedByMonth = {};
//     invoices.forEach(inv => {
//       if (inv.received === "Yes" && inv.received_date) {
//         const m = inv.received_date.slice(0,7);
//         if (m) (actualReceivedByMonth[m] ||= []).push(inv);
//       }
//     });

//     const paidExpensesByMonth = {};
//     expensePayments.forEach(p => {
//       const m = p.paid_date?.slice(0,7) || (p.month_year ? p.month_year.slice(0,7) : null);
//       if (m) (paidExpensesByMonth[m] ||= []).push(p);
//     });

//     const paymentsByExpenseId = {};
//     expensePayments.forEach(raw => {
//       const p = {
//         ...raw,
//         paid_amount: raw.paid_amount != null ? Number(raw.paid_amount) : (raw.actual_amount != null ? Number(raw.actual_amount) : null)
//       };
//       (paymentsByExpenseId[p.expense_id] ||= []).push(p);
//     });

//     // salaryMap by normalized employee code -> { month: record }
//     const salaryMap = {};
//     salaryPayments.forEach(sp => {
//       const emp = normalizeEmpCode(sp.employee_id);
//       if (!emp) return;
//       salaryMap[emp] ||= {};
//       salaryMap[emp][sp.month] = {
//         id: sp.id,
//         employee_name: sp.employee_name,
//         paid: String(sp.paid || "No"),
//         month: sp.month,
//         lop: sp.lop != null ? Number(sp.lop) : 0,
//         paid_amount: sp.paid_amount != null ? Number(sp.paid_amount) : 0,
//         actual_to_pay: sp.actual_to_pay != null ? Number(sp.actual_to_pay) : 0,
//         paid_date: sp.paid_date || null,
//         due_date: sp.due_date || null,
//       };
//     });

//     const getLatestExpensePayment = (expenseId) => {
//       const list = paymentsByExpenseId[expenseId] || [];
//       if (!list.length) return null;
//       const paid = list.find(p => String(p.status || "").toLowerCase() === "paid");
//       if (paid) return paid;
//       return [...list].sort((a,b) => {
//         const da = a.paid_date ? new Date(a.paid_date) : (a.month_year ? new Date(a.month_year + "-01") : new Date(0));
//         const db = b.paid_date ? new Date(b.paid_date) : (b.month_year ? new Date(b.month_year + "-01") : new Date(0));
//         return db - da;
//       })[0] || null;
//     };

//     // ---------- build months array ----------
//     const months = [];

//     for (const monthKey of monthKeys) {
//       const forecastExpenseItems = [];

//       // 1) Regular expenses (carry forward per-month)
//       const regularExpenses = allExpenses.filter(e => isRegularYes(e));

//       regularExpenses.forEach(exp => {
//         const parsed = parseTypeWithEmployee(exp.type);
//         const baseType = parsed.baseType || "";
//         const empCodeRaw = parsed.employeeCode || null;
//         const empCode = normalizeEmpCode(empCodeRaw);

//         const startMonth = (exp.raised_date && exp.raised_date.slice(0,7)) || (exp.due_date && exp.due_date.slice(0,7));
//         if (!startMonth) return;
//         if (startMonth > monthKey) return;

//         const originalDate = exp.due_date || exp.raised_date || (startMonth + "-01");
//         const originalDay = (originalDate && originalDate.split("-")[2]) ? Number(originalDate.split("-")[2]) : 1;

//         const monthsToCheck = monthsBetweenInclusive(startMonth, monthKey);

//         // For each carried month `ym` we check if that exact ym is paid
//         monthsToCheck.forEach((ym) => {
//           let paidThisMonth = false;

//           if (isSalaryType(exp.type) && empCode) {
//             const empMonths = salaryMap[empCode] || {};
//             if (Object.prototype.hasOwnProperty.call(empMonths, ym)) {
//               paidThisMonth = String(empMonths[ym].paid || "").toLowerCase() === "yes";
//             } else {
//               paidThisMonth = false;
//             }
//           } else {
//             const payments = paymentsByExpenseId[exp.auto_id] || [];
//             // strict match on month_year
//             paidThisMonth = payments.some(p => String(p.status || "").toLowerCase() === "paid" && p.month_year === ym);
//           }

//           if (!paidThisMonth) {
//             const effectiveDue = buildEffectiveDueDate(ym, originalDay);
//             forecastExpenseItems.push({
//               expense_id: exp.auto_id,
//               type: exp.type,
//               description: exp.description,
//               baseType,
//               employeeName: parsed.employeeName || null,
//               employeeCode: empCode || null,
//               amount: Number(exp.amount || 0),
//               regular: "Yes",
//               original_due_date: exp.due_date || null,
//               effective_due_date: effectiveDue,
//               due_date: effectiveDue,
//               carry_for_month: ym,
//               paid_amount: 0,
//               paid_date: null,
//               status: "Unpaid",
//               _source: "regular-carryforward",
//             });
//           }
//         });
//       });

//       // 2) One-time unpaid items where dueMonth <= monthKey
//       const oneTimeExpenses = allExpenses.filter(e => !isRegularYes(e));
//       oneTimeExpenses.forEach(exp => {
//         const dueMonth = (exp.due_date && exp.due_date.slice(0,7)) || (exp.raised_date && exp.raised_date.slice(0,7));
//         if (!dueMonth) return;
//         if (dueMonth > monthKey) return;

//         const latest = getLatestExpensePayment(exp.auto_id);
//         const isPaid = latest && String(latest.status || "").toLowerCase() === "paid";

//         if (!isPaid) {
//           const originalDate = exp.due_date || exp.raised_date || (dueMonth + "-01");
//           const originalDay = (originalDate && originalDate.split("-")[2]) ? Number(originalDate.split("-")[2]) : 1;
//           const effectiveDue = buildEffectiveDueDate(monthKey, originalDay);
//           forecastExpenseItems.push({
//             expense_id: exp.auto_id,
//             type: exp.type,
//             description: exp.description,
//             amount: Number(exp.amount || 0),
//             regular: "No",
//             original_due_date: exp.due_date || null,
//             effective_due_date: effectiveDue,
//             due_date: effectiveDue,
//             paid_amount: latest ? Number(latest.paid_amount || latest.actual_amount || 0) : 0,
//             paid_date: latest ? (latest.paid_date || null) : null,
//             status: latest ? latest.status : "Unpaid",
//             _source: "one-time-carry",
//           });
//         }
//       });

//       // 3) Actual expense payments for this outer monthKey (show paid ones)
//       const actualExpenseItems = (paidExpensesByMonth[monthKey] || []).map(ep => {
//         const paidAmount = ep.paid_amount != null ? Number(ep.paid_amount) : (ep.actual_amount != null ? Number(ep.actual_amount) : 0);
//         const expenseRow = allExpenses.find(e => e.auto_id === ep.expense_id) || null;
//         const dueFromExpense = expenseRow ? expenseRow.due_date : (ep.due_date || null);
//         return {
//           expense_id: ep.expense_id,
//           expense_type: expenseRow ? expenseRow.type : null,
//           description: expenseRow ? expenseRow.description : ep.description || null,
//           amount: paidAmount,
//           paid_amount: paidAmount,
//           actual_amount: ep.actual_amount != null ? Number(ep.actual_amount) : null,
//           due_date: dueFromExpense || null,
//           paid_date: ep.paid_date || null,
//           regular: expenseRow ? String(expenseRow.regular || "No") : "No",
//           status: ep.status || "Paid",
//           _source: "actual-expense-payment",
//         };
//       });

//       const actualExpenseTotal = actualExpenseItems.reduce((s,a) => s + (a.amount || 0), 0);
//       const forecastExpenseTotal = forecastExpenseItems.reduce((s,a) => s + (Number(a.paid_amount || a.amount || 0)), 0);

//       // Income sections (unchanged)
//       const actualIncomeItems = (actualReceivedByMonth[monthKey] || []).map(inv => ({
//         invoice_id: inv.id,
//         invoice_number: inv.invoice_number,
//         project_id: inv.project_id,
//         invoice_value: Number(inv.invoice_value || 0),
//         total_with_gst: Number(inv.invoice_value || 0),
//         gst_amount: Number(inv.gst_amount || 0),
//         received_date: inv.received_date || null,
//         _source: "actual-income",
//       }));
//       const actualIncomeTotal = actualIncomeItems.reduce((s,a) => s + (a.total_with_gst || 0), 0);

//       const forecastIncomeItems = (invoicesByDueMonth[monthKey] || []).map(inv => ({
//         invoice_id: inv.id,
//         invoice_number: inv.invoice_number,
//         project_id: inv.project_id,
//         invoice_value: Number(inv.invoice_value || 0),
//         total_with_gst: Number(inv.invoice_value || 0),
//         gst_amount: Number(inv.gst_amount || 0),
//         due_date: inv.due_date || null,
//         _source: "forecast-invoice",
//       }));

//       // project-based forecast
//       projects.forEach(p => {
//         const netPayable = Number(p.netPayable || p.net_payable || 0);
//         if (!netPayable || netPayable <= 0) return;
//         const startMonth = p.startDate ? String(p.startDate).slice(0,7) : null;
//         const endMonth = p.endDate ? String(p.endDate).slice(0,7) : null;
//         if (startMonth && monthKey < startMonth) return;
//         if (endMonth && monthKey > endMonth) return;
//         const cycle = String(p.invoiceCycle || "Monthly").toLowerCase();
//         if (cycle === "quarterly" && startMonth) {
//           const [sy, sm] = startMonth.split("-").map(Number);
//           const [cy, cm] = monthKey.split("-").map(Number);
//           const diff = (cy - sy) * 12 + (cm - sm);
//           if (diff % 3 !== 0) return;
//         }
//         const invoiceExists = (invoicesByDueMonth[monthKey] || []).some(inv => inv.project_id === p.projectID);
//         if (invoiceExists) return;
//         forecastIncomeItems.push({
//           project_id: p.projectID,
//           projectName: p.projectName,
//           invoice_value: netPayable,
//           total_with_gst: netPayable,
//           gst_amount: 0,
//           _source: "project-forecast",
//         });
//       });

//       const forecastIncomeTotal = forecastIncomeItems.reduce((s,a) => s + (Number(a.total_with_gst || a.invoice_value || 0)), 0);

//       months.push({
//         month: monthKey,
//         actualIncomeTotal,
//         actualIncomeItems,
//         forecastIncomeTotal,
//         forecastIncomeItems,
//         actualExpenseTotal,
//         actualExpenseItems,
//         forecastExpenseTotal,
//         forecastExpenseItems,
//         monthlyBalance: forecastIncomeTotal - forecastExpenseTotal,
//       });
//     } // end months loop
      
//     return res.json({
//       success: true,
//       message: "Forecast generated (fixed ym scoping + strict per-month paid detection)",
//       months,
//     });
   
//   } catch (err) {
//     console.error("❌ Forecast Error:", err);
//     return res.status(500).json({ success: false, message: err.message });
//   }
// });





app.get("/monthly-last-balances", (req, res) => {
  const { month } = req.query; // YYYY-MM
 
  if (!month) {
    return res.status(400).json({
      success: false,
      message: "month is required (YYYY-MM)"
    });
  }
 
  const sql = `
    SELECT
      strftime('%Y-%m', t.created_at) AS month,
      t.updated_balance
    FROM transactions t
    JOIN accounts a ON t.account_number = a.account_number
    WHERE a.account_type = 'Current'
      AND strftime('%Y-%m', t.created_at) = ?
    ORDER BY t.created_at DESC
    LIMIT 1;
  `;
 
  req.app.locals.db.get(sql, [month], (err, row) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
 
    res.json({
      success: true,
      data: row ? [row] : []
    });
  });
});









// -----------------------------------------------------------------------------
// 📅 Forecast Details for a Specific Date (Net Cash Flow = Account + Forecast Adjustments)
// -----------------------------------------------------------------------------
app.get("/forecast/details", async (req, res) => {
  const db = req.app.locals.db;
  if (!db) return res.status(500).json({ error: "Database not initialized" });

  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "Missing 'date' query param" });

  console.log(`🔍 Fetching forecast details for ${date}`);

  const safeQuery = async (label, query, params = []) => {
    try {
      const result = await runQuery(db, query, params);
      console.log(`✅ ${label}: ${result.length} rows`);
      return result;
    } catch (err) {
      console.error(`❌ Query failed [${label}]:`, err.message);
      return [];
    }
  };

  try {
    // ✅ 1️⃣ Actual Income (received already — for info only)
    const actualIncome = await safeQuery(
      "Actual Income",
      `
      SELECT 
        client_name,
        invoice_number,
        project_id,
        invoice_value,
        gst_amount,
        received_date
      FROM invoices
      WHERE received = 'Yes'
        AND date(received_date) = date(?);
      `,
      [date]
    );

    // 📈 2️⃣ Forecasted Income (due but not received)
    const forecastedIncome = await safeQuery(
      "Forecasted Income",
      `
      SELECT 
        client_name,
        invoice_number,
        project_id,
        invoice_value,
        gst_amount,
        due_date
      FROM invoices
      WHERE received = 'No'
        AND date(due_date) = date(?);
      `,
      [date]
    );

    // 💸 3️⃣ Actual Expenses (already reflected — info only)
    const actualExpenses = await safeQuery(
      "Actual Expenses",
      `
      SELECT 
        e.type AS expense_type,
        e.description,
        ep.paid_amount,
        ep.paid_date
      FROM expense_payments ep
      JOIN expenses e ON e.auto_id = ep.expense_id
      WHERE ep.status = 'Paid'
        AND date(ep.paid_date) = date(?);
      `,
      [date]
    );

    // 🧾 4️⃣ Forecasted Expenses (unpaid)
    const forecastedExpenses = await safeQuery(
      "Forecasted Expenses",
      `
      SELECT 
        e.type AS expense_type,
        e.description,
        e.amount,
        e.currency,
        e.regular,
        e.due_date
      FROM expenses e
      WHERE date(e.due_date) = date(?)
        AND e.auto_id NOT IN (
          SELECT expense_id FROM expense_payments WHERE status = 'Paid'
        );
      `,
      [date]
    );

    // 👤 5️⃣ Salaries (paid or forecasted)
    const salaries = await safeQuery(
      "Salaries",
      `
      SELECT 
        e.employee_name,
        e.employee_id,
        msp.paid_amount,
        msp.paid_date,
        msp.month
      FROM employees e
      LEFT JOIN monthly_salary_payments msp
        ON LOWER(TRIM(e.employee_id)) = LOWER(TRIM(msp.employee_id))
      WHERE 
        (msp.paid_date IS NOT NULL AND date(msp.paid_date) = date(?))
        OR (e.date_of_joining IS NOT NULL AND date(e.date_of_joining) = date(?));
      `,
      [date, date]
    );

    // 💰 Totals
    const forecastedIncomeTotal = forecastedIncome.reduce(
      (sum, i) => sum + (Number(i.invoice_value) + Number(i.gst_amount || 0)),
      0
    );
    const forecastedExpensesTotal = forecastedExpenses.reduce(
      (sum, e) => sum + Number(e.amount || 0),
      0
    );
    const forecastedSalariesTotal = salaries
      .filter((s) => !s.paid_date) // only unpaid salaries
      .reduce((sum, s) => sum + Number(s.paid_amount || 0), 0);

    // 🏦 6️⃣ Current Account Balance
    const currentAccountRow = await safeQuery(
      "Current Account Balance",
      `
      SELECT account_name, account_number, balance
      FROM accounts
      WHERE LOWER(account_type) = 'current'
      LIMIT 1;
      `
    );

    const currentAccountBalance =
      currentAccountRow.length > 0
        ? Number(currentAccountRow[0].balance || 0)
        : 0;

    // 🧮 7️⃣ Net Cash Flow (forecast projection only)
    const inflows = forecastedIncomeTotal;
    const outflows = forecastedExpensesTotal + forecastedSalariesTotal;
    const monthlyBalance = currentAccountBalance + inflows - outflows;

    // ✅ Response
    res.json({
      date,
      summary: {
        currentAccountBalance,
        forecastedIncomeTotal,
        forecastedExpensesTotal,
        forecastedSalariesTotal,
        inflows,
        outflows,
        monthlyBalance,
      },
      details: {
        actualIncome,
        forecastedIncome,
        actualExpenses,
        forecastedExpenses,
        salaries,
      },
    });

    console.log(
      `✅ Forecast-only Cash Flow for ${date}: ₹${monthlyBalance.toLocaleString()}`
    );
  } catch (err) {
    console.error("❌ Forecast Details API Fatal Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 📈 MONTHLY SUMMARY ENDPOINT (aligned with /forecast)
// -----------------------------------------------------------------------------
app.get("/monthly-summary", async (req, res) => {
  try {
    console.log("📊 Monthly Summary API Called");

    const db = req.app.locals.db;
    if (!db) throw new Error("Database not initialized");

    const today = new Date();
    const currentMonthKey = today.toISOString().slice(0, 7);

    const transactions = await runQuery(db, `
      SELECT 
        strftime('%Y-%m', created_at) AS month,
        SUM(CASE WHEN type='Credit' THEN amount ELSE 0 END) AS credit_total,
        SUM(CASE WHEN type='Debit' THEN amount ELSE 0 END) AS debit_total
      FROM transactions
      GROUP BY month;
    `);

    const summaryMap = {};
    transactions.forEach(r => {
      if (!r.month) return;
      summaryMap[r.month] = {
        month: r.month,
        credit_total: Number(r.credit_total || 0),
        debit_total: Number(r.debit_total || 0),
        forecast: false
      };
    });

    const projects = await runQuery(db, `
      SELECT startDate, endDate, netPayable AS monthlyBilling
      FROM Projects WHERE active='Yes';
    `);

    const salaryRows = await runQuery(db, `
      SELECT employee_id, strftime('%Y-%m', paid_date) AS month, SUM(paid_amount) AS paid
      FROM monthly_salary_payments
      WHERE paid='Yes' AND paid_date IS NOT NULL
      GROUP BY employee_id, month;
    `);

    const salariesMap = {};
    salaryRows.forEach(s => {
      if (!s.month) return;
      if (!salariesMap[s.employee_id]) salariesMap[s.employee_id] = {};
      salariesMap[s.employee_id][s.month] = Number(s.paid || 0);
    });

    const forecastMonths = 6;
    const forecastMonthsArr = [];
    for (let i = 0; i < forecastMonths; i++) {
      const m = new Date(today);
      m.setMonth(today.getMonth() + i);
      forecastMonthsArr.push(m.toISOString().slice(0, 7));
    }

    forecastMonthsArr.forEach(monthKey => {
      if (monthKey < currentMonthKey) return;

      let projectIncome = 0;
      let projectExpense = 0;

      projects.forEach(p => {
        const start = p.startDate?.slice(0, 7);
        const end = p.endDate?.slice(0, 7);
        if (start && monthKey >= start && (!end || monthKey <= end))
          projectIncome += Number(p.monthlyBilling || 0);
      });

      Object.keys(salariesMap).forEach(empId => {
        if (salariesMap[empId][monthKey]) {
          projectExpense += salariesMap[empId][monthKey];
        } else {
          const paidMonths = Object.keys(salariesMap[empId]).sort().slice(-3);
          const avg = paidMonths.length
            ? paidMonths.reduce((s, m) => s + salariesMap[empId][m], 0) / paidMonths.length
            : 0;
          projectExpense += avg;
        }
      });

      summaryMap[monthKey] = {
        month: monthKey,
        credit_total: projectIncome,
        debit_total: projectExpense,
        forecast: true
      };
    });

    const summary = Object.values(summaryMap).sort((a, b) =>
      a.month.localeCompare(b.month)
    );
    const actual = summary.filter(m => m.month <= currentMonthKey);
    const forecast = summary.filter(m => m.month > currentMonthKey);

    res.json({
      success: true,
      currentMonth: currentMonthKey,
      actual,
      forecast,
      all: summary
    });

    console.log("✅ Monthly Summary Prepared for", currentMonthKey);
  } catch (err) {
    console.error("❌ Error in /monthly-summary:", err);
    res.status(500).json({
      success: false,
      message: err.message,
      actual: [],
      forecast: []
    });
  }
});



// -----------------------------------------------------------------------------
// 💰 UPDATE / ADD MONTHLY SALARY RECORD
// -----------------------------------------------------------------------------
// app.put("/update-salary/:employee_id", (req, res) => {
//   const { employee_id } = req.params;
//   const { month, actual_to_pay, due_date } = req.body;

//   // ✅ Input validation
//   if (!employee_id || !month || !actual_to_pay || !due_date) {
//     return res.status(400).json({
//       error: "Employee ID, month, actual_to_pay, and due_date are required.",
//     });
//   }

//   // Ensure month format is YYYY-MM
//   const formattedMonth = month.slice(0, 7);

//   // Step 1️⃣: Check if record exists
//   const checkQuery = `
//     SELECT * FROM monthly_salary_payments
//     WHERE employee_id = ? AND month = ?
//   `;

//   db.get(checkQuery, [employee_id, formattedMonth], (err, record) => {
//     if (err) {
//       console.error("❌ Error checking salary record:", err);
//       return res.status(500).json({ error: "Database check failed." });
//     }

//     if (record) {
//       // Step 2️⃣: Update existing record
//       const updateQuery = `
//         UPDATE monthly_salary_payments
//         SET 
//           actual_to_pay = ?, 
//           due_date = ?, 
//           paid = 'No',
//           paid_amount = 0
//         WHERE employee_id = ? AND month = ?
//       `;

//       db.run(updateQuery, [actual_to_pay, due_date, employee_id, formattedMonth], function (err) {
//         if (err) {
//           console.error("❌ Error updating salary:", err);
//           return res.status(500).json({ error: "Failed to update salary record." });
//         }

//         console.log(`✅ Salary updated for ${employee_id} (${formattedMonth})`);
//         res.json({
//           success: true,
//           message: "Salary record updated successfully.",
//           data: { employee_id, month: formattedMonth, actual_to_pay, due_date, paid: "No" },
//         });
//       });
//     } else {
//       // Step 3️⃣: Insert new record
//       const getEmployeeQuery = `SELECT employee_name FROM salary_payments WHERE employee_id = ?`;
//       db.get(getEmployeeQuery, [employee_id], (err, emp) => {
//         if (err || !emp) {
//           console.error("❌ Error fetching employee name:", err);
//           return res.status(404).json({ error: "Employee not found in salary_payments table." });
//         }

//         const insertQuery = `
//           INSERT INTO monthly_salary_payments 
//           (employee_id, employee_name, month, actual_to_pay, due_date, paid, paid_amount)
//           VALUES (?, ?, ?, ?, ?, 'No', 0)
//         `;

//         db.run(insertQuery, [employee_id, emp.employee_name, formattedMonth, actual_to_pay, due_date], function (err) {
//           if (err) {
//             console.error("❌ Error inserting new salary:", err);
//             return res.status(500).json({ error: "Failed to insert salary record." });
//           }

//           console.log(`✅ New salary record created for ${employee_id} (${formattedMonth})`);
//           res.json({
//             success: true,
//             message: "Salary record created successfully.",
//             data: { employee_id, month: formattedMonth, actual_to_pay, due_date, paid: "No" },
//           });
//         });
//       });
//     }
//   });
// });

app.put("/update-salary/:employee_id", (req, res) => {
  const { employee_id } = req.params;
  const { month, actual_to_pay, due_date } = req.body;

  if (!employee_id || !month || !actual_to_pay || !due_date) {
    return res.status(400).json({
      error: "Employee ID, month, actual_to_pay, and due_date are required.",
    });
  }

  const formattedMonth = month.slice(0, 7);

  const checkQuery = `
    SELECT * FROM monthly_salary_payments
    WHERE employee_id = ? AND month = ?
  `;

  db.get(checkQuery, [employee_id, formattedMonth], (err, record) => {
    if (err) {
      console.error("❌ Error checking salary record:", err);
      return res.status(500).json({ error: "Database check failed." });
    }

    if (record) {
      // --------------------------------------------------------------------
      // 🔥 Step 1: UPDATE existing monthly_salary_payments
      // --------------------------------------------------------------------
      const updateQuery = `
        UPDATE monthly_salary_payments
        SET actual_to_pay = ?, due_date = ?, paid = 'No', paid_amount = 0
        WHERE employee_id = ? AND month = ?
      `;

      db.run(updateQuery, [actual_to_pay, due_date, employee_id, formattedMonth], function (err) {
        if (err) {
          console.error("❌ Error updating salary:", err);
          return res.status(500).json({ error: "Failed to update salary record." });
        }

        // Continue to update expenses_payment
        handleExpensePaymentUpdate(employee_id, formattedMonth, actual_to_pay, due_date);
        res.json({
          success: true,
          message: "Salary updated & expense payment updated.",
        });
      });

    } else {
      // --------------------------------------------------------------------
      // 🔥 Step 2: INSERT new monthly_salary_payments
      // --------------------------------------------------------------------
      const getEmployeeQuery = `SELECT employee_name FROM salary_payments WHERE employee_id = ?`;

      db.get(getEmployeeQuery, [employee_id], (err, emp) => {
        if (err || !emp) {
          console.error("❌ Error fetching employee name:", err);
          return res.status(404).json({ error: "Employee not found in salary_payments table." });
        }

        const insertQuery = `
          INSERT INTO monthly_salary_payments
          (employee_id, employee_name, month, actual_to_pay, due_date, paid, paid_amount)
          VALUES (?, ?, ?, ?, ?, 'No', 0)
        `;

        db.run(insertQuery, [employee_id, emp.employee_name, formattedMonth, actual_to_pay, due_date], function (err) {
          if (err) {
            console.error("❌ Error inserting new salary:", err);
            return res.status(500).json({ error: "Failed to insert salary record." });
          }

          // Continue to update expenses_payment
          handleExpensePaymentUpdate(employee_id, formattedMonth, actual_to_pay, due_date);

          res.json({
            success: true,
            message: "Salary created & expense payment inserted.",
          });
        });
      });
    }
  });
});


// ======================================================================
// ⭐ FUNCTION TO INSERT OR UPDATE expense_payments
// ======================================================================
function handleExpensePaymentUpdate(employee_id, month_year, actual_to_pay, due_date) {
  // Fetch employee name to match expenses.type
  const empQuery = `SELECT employee_name FROM salary_payments WHERE employee_id = ?`;

  db.get(empQuery, [employee_id], (err, emp) => {
    if (err || !emp) {
      return console.error("❌ Employee not found for expense mapping.");
    }

    const typePattern = `Salary - ${emp.employee_name} (${employee_id})`;

    // 1️⃣ Find matching expense entry
    const findExpenseQuery = `
      SELECT auto_id FROM expenses
      WHERE type = ?
    `;

    db.get(findExpenseQuery, [typePattern], (err, expense) => {
      if (err || !expense) {
        return console.error("❌ Matching expense not found for:", typePattern);
      }

      const expense_id = expense.auto_id;

      // 2️⃣ Check if expense_payments entry exists
      const checkExpensePayQuery = `
        SELECT * FROM expense_payments
        WHERE expense_id = ? AND month_year = ?
      `;

      db.get(checkExpensePayQuery, [expense_id, month_year], (err, rec) => {
        if (err) {
          return console.error("❌ Error checking expense_payments:", err);
        }

        if (rec) {
          // 3️⃣ UPDATE existing expense_payment
          const updateExpensePay = `
            UPDATE expense_payments
            SET actual_amount = ?, due_date = ?, status = 'Raised'
            WHERE expense_id = ? AND month_year = ?
          `;

          db.run(updateExpensePay, [actual_to_pay, due_date, expense_id, month_year], (err) => {
            if (err) console.error("❌ Error updating expense_payments:", err);
          });

        } else {
          // 4️⃣ INSERT new expense_payment
          const insertExpensePay = `
            INSERT INTO expense_payments 
            (expense_id, month_year, actual_amount, paid_amount, paid_date, status, remarks, due_date)
            VALUES (?, ?, ?, NULL, NULL, 'Raised', NULL, ?)
          `;

          db.run(insertExpensePay, [expense_id, month_year, actual_to_pay, due_date], (err) => {
            if (err) console.error("❌ Error inserting expense_payments:", err);
          });
        }
      });
    });
  });
}

// -----------------------------------------------------------------------------
// 💰 ADD MONTHLY Expense RECORD
// -----------------------------------------------------------------------------
app.post("/saveExpensePayment", (req, res) => {
  const { expense_id, month_year, actual_amount, due_date } = req.body;

  if (!expense_id || !month_year || !actual_amount || !due_date) {
    return res.status(400).json({
      error: "expense_id, month_year, actual_amount, due_date are required."
    });
  }

  const status = "Raised";

  // ==========================================================
  // 1️⃣ UPSERT INTO expense_payments  (same as your old code)
  // ==========================================================
  const expenseSQL = `
    INSERT INTO expense_payments (
      expense_id, month_year, actual_amount, status, due_date
    )
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(expense_id, month_year)
    DO UPDATE SET
      actual_amount = excluded.actual_amount,
      status = excluded.status,
      due_date = excluded.due_date;
  `;

  db.run(
    expenseSQL,
    [expense_id, month_year, actual_amount, status, due_date],
    function (err) {
      if (err) {
        console.error("❌ Error saving expense_payment:", err);
        return res.status(500).send("DB error while saving expense");
      }

      // 2️⃣ Now also update MONTHLY SALARY table
      updateSalaryFromExpense(expense_id, month_year, actual_amount, due_date);

      res.send({ message: "Expense & Salary Updated", id: this.lastID });
    }
  );
});

// db.run(`
//   CREATE UNIQUE INDEX IF NOT EXISTS idx_salary_unique
//   ON monthly_salary_payments (employee_id, month);
// `);

function updateSalaryFromExpense(expense_id, month_year, actual_amount, due_date) {
  // 1️⃣ Get expense type to find employee
  const findExpense = `
    SELECT type FROM expenses WHERE auto_id = ?
  `;

  db.get(findExpense, [expense_id], (err, exp) => {
    if (err || !exp) {
      return console.error("❌ Expense not found for salary sync.");
    }

    const type = exp.type;

    // Must be like: Salary - David Santhan (IND343)
    if (!/salary/i.test(type)) {
      return; // not a salary expense
    }

    // Extract name and ID
    const namePart = type.replace(/salary\s*-\s*/i, "").trim();
    const employeeName = namePart.replace(/\([^)]*\)/g, "").trim(); // "David Santhan"
    const idMatch = type.match(/\(([^)]+)\)/);                      // (IND343)
    const employee_id = idMatch ? idMatch[1] : null;

    if (!employee_id) {
      return console.error("❌ Could not extract employee_id from:", type);
    }

    // ==========================================================
    // 2️⃣ UPSERT into monthly_salary_payments
    // ==========================================================
    const salarySQL = `
      INSERT INTO monthly_salary_payments (
        employee_id,
        employee_name,
        paid,
        month,
        lop,
        paid_amount,
        actual_to_pay,
        paid_date,
        due_date
      )
      VALUES (?, ?, 'No', ?, 0, 0, ?, NULL, ?)

      ON CONFLICT(employee_id, month)
      DO UPDATE SET
        actual_to_pay = excluded.actual_to_pay,
        due_date = excluded.due_date,
        paid = 'No',
        paid_amount = 0,
        paid_date = NULL;
    `;

    db.run(
      salarySQL,
      [employee_id, employeeName, month_year, actual_amount, due_date],
      (err) => {
        if (err) {
          console.error("❌ Error updating monthly salary:", err);
        } else {
          console.log("✅ Monthly salary updated from expense payment");
        }
      }
    );
  });
}







app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});