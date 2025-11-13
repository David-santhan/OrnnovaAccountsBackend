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
    employee_id TEXT UNIQUE NOT NULL,
    employee_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone_number INTEGER,
    skills TEXT,
    resume TEXT,
    photo TEXT,
    ctc TEXT,
    salary_paid TEXT CHECK(salary_paid IN ('Yes','No')),
     ctc_effective_from TEXT DEFAULT (strftime('%Y-%m', 'now')), -- ✅ new
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
// app.get("/getprojects", (req, res) => {
//   // 1️⃣ Fetch all projects
//   db.all("SELECT * FROM Projects", [], (err, projects) => {
//     if (err) return res.status(500).json({ error: err.message });

//     db.all("SELECT employee_id, employee_name FROM employees", [], (err, emps) => {
//       if (err) return res.status(500).json({ error: err.message });

//       const map = new Map(emps.map(e => [e.employee_id, e.employee_name]));
//       const formatted = rows.map(row => {
//         let parsed = [];
//         try {
//           const arr = JSON.parse(row.employees || "[]");
//           parsed = arr.map(emp => ({
//             id: typeof emp === "string" ? emp : emp.id,
//             name: typeof emp === "string" ? map.get(emp) : emp.name,
//           }));
//         } catch {
//           parsed = [];
//         }
//         return { ...row, employees: parsed };
//       });

//       res.json(formatted);
//     });
//   });
// });

app.get("/getprojects", (req, res) => {
  // 1️⃣ Fetch all projects
  db.all("SELECT * FROM Projects", [], (err, projects) => {
    if (err) return res.status(500).json({ error: err.message });

    // 2️⃣ Fetch all employees
    db.all("SELECT employee_id, employee_name FROM employees", [], (err, emps) => {
      if (err) return res.status(500).json({ error: err.message });

      // 3️⃣ Map employee IDs to names for lookup
      const empMap = new Map(emps.map(e => [e.employee_id, e.employee_name]));

      // 4️⃣ Format each project’s employees
      const formatted = projects.map(project => {
        let parsed = [];
        try {
          const arr = JSON.parse(project.employees || "[]");
          parsed = arr.map(emp => ({
            id: typeof emp === "string" ? emp : emp.id,
            name: typeof emp === "string" ? empMap.get(emp) : emp.name,
          }));
        } catch {
          parsed = [];
        }
        return { ...project, employees: parsed };
      });

      // 5️⃣ Send final response
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
  console.log("📩 Incoming salary data:", req.body);

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
      req.body.employee_id,
      req.body.employee_name,
      req.body.month,
      req.body.paid || "No",
      req.body.paid_date || null,
      req.body.basic_pay || 0,
      req.body.hra || 0,
      req.body.conveyance_allowance || 0,
      req.body.medical_allowance || 0,
      req.body.lta || 0,
      req.body.personal_allowance || 0,
      req.body.gross_salary || 0,
      req.body.ctc || 0,
      req.body.professional_tax || 0,
      req.body.insurance || 0,
      req.body.pf || 0,
      req.body.tds || 0,
      req.body.employer_pf || 0,
      req.body.employer_health_insurance || 0,
      req.body.net_takehome || 0,
    ],
    function (err) {
      if (err) {
        console.error("❌ Salary Insert Error:", err);
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



//here onwords forecastion..........................................



// // Post Forecast
// app.post("/forecasts", (req, res) => {
//   const { name, start_date, end_date } = req.body;

//   if (!name || !start_date || !end_date) {
//     return res.status(400).json({ error: "All fields are required" });
//   }

//   db.run(
//     `INSERT INTO forecasts (name, start_date, end_date) VALUES (?, ?, ?)`,
//     [name, start_date, end_date],
//     function (err) {
//       if (err) return res.status(500).json({ error: err.message });
//       res.json({ success: true, forecast_id: this.lastID });
//     }
//   );
// });

// // Get Forcasts
// app.get("/forecasts", (req, res) => {
//   db.all(`SELECT * FROM forecasts`, [], (err, rows) => {
//     if (err) return res.status(500).json({ error: err.message });
//     res.json({ forecasts: rows });
//   });
// });

// // Update forcast End Date
// app.put("/forecasts/:id", (req, res) => {
//   const { id } = req.params;
//   const { end_date } = req.body;

//   if (!end_date) return res.status(400).json({ error: "End date is required" });

//   db.run(
//     `UPDATE forecasts SET end_date = ? WHERE id = ?`,
//     [end_date, id],
//     function (err) {
//       if (err) return res.status(500).json({ error: err.message });
//       if (this.changes === 0)
//         return res.status(404).json({ error: "Forecast not found" });

//       res.json({ success: true, message: "End date updated successfully" });
//     }
//   );
// });

// // POST /transactions
// app.post("/transactions", (req, res) => {
//   const { forecast_id, name, type, amount, start_date, end_date, category } = req.body;

//   if (!forecast_id || !name || !type || !amount || !start_date) {
//     return res.status(400).json({ error: "Missing required fields" });
//   }

//   db.get("SELECT end_date FROM forecasts WHERE id = ?", [forecast_id], (err, forecast) => {
//     if (err) {
//       console.error("DB Error:", err);
//       return res.status(500).json({ error: err.message });
//     }

//     if (!forecast) {
//       console.error("Forecast not found for id:", forecast_id);
//       return res.status(404).json({ error: "Forecast not found" });
//     }

//     const finalEndDate = end_date || forecast.end_date;

//     db.run(
//       `INSERT INTO forecast_transactions (forecast_id, name, type, amount, start_date, end_date, category)
//        VALUES (?, ?, ?, ?, ?, ?, ?)`,
//       [forecast_id, name, type, amount, start_date, finalEndDate, category || null],
//       function (err) {
//         if (err) {
//           console.error("Insert Error:", err);
//           return res.status(500).json({ error: err.message });
//         }
//         res.json({ success: true, transactionId: this.lastID });
//       }
//     );
//   });
// });

// // Getting Particular Forcast Transactions
// app.get("/transactions/:forecastId", (req, res) => {
//   const forecastId = req.params.forecastId;

//   const query = "SELECT * FROM forecast_transactions WHERE forecast_id = ?";

//   db.all(query, [forecastId], (err, rows) => {
//     if (err) {
//       console.error("Fetch Error:", err);
//       return res.status(500).json({ error: err.message });
//     }
//     res.json({ transactions: rows });
//   });
// });

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
    non_billable_days,
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
          gst_amount, due_date, billable_days,non_billable_days, received, received_date
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?)
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
// app.put("/employees/:id", upload.fields([
//   { name: "resume", maxCount: 1 },
//   { name: "photo", maxCount: 1 }
// ]), (req, res) => {
//   const employeeId = req.params.id;

//   const {
//     employee_id,
//     employee_name,
//     email,
//     phone_number,
//     skills,
//     salary_paid,
//     billable,
//     consultant_regular,
//     active,
//     ctc,
//     project_ending,
//     date_of_joining,
//   } = req.body;

//   // Ensure uploaded files are stored with "uploads/" path
//   const resume = req.files?.resume ? `uploads/${req.files.resume[0].filename}` : null;
//   const photo  = req.files?.photo  ? `uploads/${req.files.photo[0].filename}`  : null;

//   const fields = [
//     { key: "employee_id", value: employee_id },
//     { key: "employee_name", value: employee_name },
//     { key: "email", value: email },
//     { key: "phone_number", value: phone_number },
//     { key: "skills", value: skills },
//     { key: "salary_paid", value: salary_paid },
//     { key: "billable", value: billable },
//     { key: "consultant_regular", value: consultant_regular },
//     { key: "active", value: active },
//     { key: "project_ending", value: project_ending },
//     { key: "ctc", value: ctc },
//     { key: "resume", value: resume },
//     { key: "photo", value: photo },
//     { key: "date_of_joining", value: date_of_joining },
//   ].filter(f => f.value !== null && f.value !== undefined);

//   const setClause = fields.map(f => `${f.key} = ?`).join(", ");
//   const values = fields.map(f => f.value);
//   values.push(employeeId); // for WHERE clause

//   const sql = `UPDATE employees SET ${setClause} WHERE id = ?`;

//   db.run(sql, values, function(err) {
//     if (err) {
//       console.error(err);
//       return res.status(500).json({ error: err.message });
//     }
//     res.json({ success: true, changes: this.changes });
//   });
// });
// Helper to compute YYYY-MM for JS
// ✅ Helper: current month in YYYY-MM
function currentMonthKey(offsetMonths = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths);
  return d.toISOString().slice(0, 7); // "YYYY-MM"
}

// ✅ Update Employee + Salary logic
app.put(
  "/employees/:id",
  upload.fields([
    { name: "resume", maxCount: 1 },
    { name: "photo", maxCount: 1 },
  ]),
  (req, res) => {
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
      ctc, // New CTC
      project_ending,
      date_of_joining,
      effective_month, // Optional: custom effective month (YYYY-MM)
    } = req.body;

    const resume = req.files?.resume
      ? `uploads/${req.files.resume[0].filename}`
      : null;
    const photo = req.files?.photo
      ? `uploads/${req.files.photo[0].filename}`
      : null;

    // Collect only non-null fields
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
    ].filter((f) => f.value !== null && f.value !== undefined);

    if (fields.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const setClause = fields.map((f) => `${f.key} = ?`).join(", ");
    const values = fields.map((f) => f.value);
    values.push(employeeId);

    const sql = `UPDATE employees SET ${setClause} WHERE id = ?`;

    // Step 1️⃣: Fetch current employee (for old CTC)
    db.get("SELECT * FROM employees WHERE id = ?", [employeeId], (err, existing) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!existing) return res.status(404).json({ error: "Employee not found" });

      const oldCtc = Number(existing.ctc || 0);
      const newCtc = ctc !== undefined && ctc !== null ? Number(ctc) : oldCtc;

      // Step 2️⃣: Update employee info
      db.run(sql, values, function (err2) {
        if (err2) {
          console.error("Error updating employee:", err2.message);
          return res.status(500).json({ error: err2.message });
        }

        // Step 3️⃣: If CTC changed, record it and update salaries
        if (!isNaN(newCtc) && newCtc !== oldCtc) {
          const effMonth =
            (effective_month && String(effective_month).slice(0, 7)) ||
            currentMonthKey();

          // Insert into salary_history
          db.run(
            `INSERT INTO salary_history (employee_id, old_ctc, new_ctc, effective_month, remarks)
             VALUES (?, ?, ?, ?, ?)`,
            [existing.employee_id, oldCtc, newCtc, effMonth, "CTC updated via API"],
            function (err3) {
              if (err3) console.error("Error inserting salary_history:", err3.message);

              // Step 4️⃣: Get latest effective month from history
              db.get(
                `SELECT effective_month
                 FROM salary_history
                 WHERE employee_id = ?
                 ORDER BY CAST(REPLACE(effective_month, '-', '') AS INTEGER) DESC
                 LIMIT 1`,
                [existing.employee_id],
                (err5, row) => {
                  if (err5)
                    return res.status(500).json({
                      error: "Error fetching latest salary history: " + err5.message,
                    });

                  const effectiveFrom = row ? row.effective_month : effMonth;

                  // Step 5️⃣: Update salary structure only for effectiveFrom onward
                  const sqlUpdate = `
                    UPDATE salary_payments
                    SET
                      ctc = ?,
                      gross_salary = ROUND(? / 12.0, 2),
                      basic_pay = ROUND((? / 12.0) * 0.40, 2),
                      hra = ROUND((? / 12.0) * 0.20, 2),
                      conveyance_allowance = ROUND((? / 12.0) * 0.05, 2),
                      medical_allowance = ROUND((? / 12.0) * 0.05, 2),
                      lta = ROUND((? / 12.0) * 0.05, 2),
                      personal_allowance = ROUND((? / 12.0) * 0.25, 2),
                      pf = ROUND((? / 12.0) * 0.12, 2),
                      professional_tax = ROUND((? / 12.0) * 0.02, 2),
                      insurance = ROUND((? / 12.0) * 0.01, 2),
                      tds = ROUND((? / 12.0) * 0.05, 2),
                      employer_pf = ROUND((? / 12.0) * 0.12, 2),
                      employer_health_insurance = ROUND((? / 12.0) * 0.01, 2),
                      net_takehome = ROUND(
                        (
                          (? / 12.0) -
                          (
                            (? / 12.0) * 0.12 +
                            (? / 12.0) * 0.02 +
                            (? / 12.0) * 0.01 +
                            (? / 12.0) * 0.05
                          )
                        ), 2
                      )
                    WHERE employee_id = ?
                      AND CAST(REPLACE(month, '-', '') AS INTEGER) >= CAST(REPLACE(?, '-', '') AS INTEGER)
                  `;

                  const params = [
                    newCtc, newCtc, newCtc, newCtc, newCtc, newCtc, newCtc, newCtc,
                    newCtc, newCtc, newCtc, newCtc, newCtc, newCtc,
                    newCtc, newCtc, newCtc, newCtc, newCtc,
                    existing.employee_id,
                    effectiveFrom,
                  ];

                  db.run(sqlUpdate, params, function (err4) {
                    if (err4) {
                      console.error("Error updating salary_payments:", err4.message);
                      return res.status(500).json({
                        message:
                          "Employee updated but salary_payments update failed",
                        error: err4.message,
                      });
                    }

                    return res.json({
                      message: `✅ Employee updated and salary structure updated from ${effectiveFrom}`,
                      updatedRows: this.changes,
                    });
                  });
                }
              );
            }
          );
        } else {
          // No CTC change
          return res.json({ success: true, changes: this.changes });
        }
      });
    });
  }
);




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

          // ✅ 6. Calculate Amount (Invoice Value + GST)
          const invoiceNumber = invoice.invoice_number;
          const amount =
            (Number(invoice.invoice_value) || 0) +
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

      return res.json({
        success: true,
        message: "Salary updated successfully",
      });
    }
  );
});




// ✅ Pay Expense and Record Transaction
// ✅ Pay Expense and Record Transaction (with account deduction)
app.post("/pay-expense", (req, res) => {
  const { expense_id, paid_amount, paid_date } = req.body;
   
  if (!expense_id || !paid_amount || !paid_date) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  const amount = parseFloat(paid_amount);
  const paidMonthYear = new Date(paid_date).toLocaleString("default", {
    month: "short",
    year: "numeric",
  });

  // ⏰ Generate 4-digit time code (HHMM)
  const now = new Date();
  const timeCode = `${now.getHours().toString().padStart(2, "0")}${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;

  // 1️⃣ Get Expense details
  db.get(`SELECT * FROM expenses WHERE auto_id = ?`, [expense_id], (err, expense) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found" });

    const expenseType = expense.type || expense.description || "General";
    const isRegular = expense.regular === "Yes" ? "Regular" : "NonReg";
    const transactionId = `DEB|${isRegular}|${expenseType}|${paidMonthYear}|${timeCode}`;
    const description = `Expense paid for ${expenseType} of month ${paidMonthYear}`;

    // 2️⃣ Get Current Account
    db.get(`SELECT * FROM accounts WHERE account_type = 'Current'`, (err, currentAcc) => {
      if (err || !currentAcc) {
        return res.status(500).json({ success: false, message: "Current account not found" });
      }

      // ❌ If insufficient balance
      if (currentAcc.balance < amount) {
        return res.status(400).json({
          success: false,
          message: `Insufficient funds. Current balance: ₹${currentAcc.balance.toLocaleString()} — required: ₹${amount.toLocaleString()}`,
        });
      }

      // ✅ Enough balance → proceed with payment
      const prevBalance = currentAcc.balance;
      const newBalance = prevBalance - amount;

      db.serialize(() => {
        // 💰 Update Current Account
        db.run(`UPDATE accounts SET balance = ? WHERE account_id = ?`, [newBalance, currentAcc.account_id]);

        // 📒 Record Transaction (Debit)
        db.run(
          `
          INSERT INTO transactions 
            (transaction_id, account_number, type, amount, description, previous_balance, updated_balance, created_at)
          VALUES (?, ?, 'Debit', ?, ?, ?, ?, datetime('now'))
          `,
          [transactionId, currentAcc.account_number, amount, description, prevBalance, newBalance]
        );

        // 🧾 Insert or Update expense_payments
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
          [expense_id, paidMonthYear, expense.amount || amount, amount, paid_date]
        );

        return res.json({
          success: true,
          message: `Expense paid successfully. ₹${amount} debited from Current Account.`,
          transaction_id: transactionId,
          previous_balance: prevBalance,
          updated_balance: newBalance,
        });
      });
    });
  });
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

  // 🗓️ Convert "YYYY-MM" → "Nov 2025"
  const date = new Date(`${month}-01`);
  const formattedMonth = date.toLocaleString("default", { month: "short", year: "numeric" });

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
      e.status AS expense_status,
      ep.paid_amount,
      ep.paid_date,
      ep.status AS payment_status
    FROM expenses e
    LEFT JOIN expense_payments ep
      ON e.auto_id = ep.expense_id AND ep.month_year = ?
    ORDER BY e.auto_id DESC
  `;

  db.all(sql, [formattedMonth], (err, rows) => {
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
      paid_amount: row.paid_amount || 0,
      paid_date: row.paid_date || "Not Paid",
      paymentstatus: row.payment_status || "Pending",
      expensestatus: row.expense_status || "Raised",
    }));

    res.json(formatted);
    console.log(formatted);
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


// // PATCH: Add balance
// app.patch("/accounts/:number/add-balance", (req, res) => {
//   const { amount } = req.body;
//   const { number } = req.params;

//   if (!amount || amount <= 0)
//     return res.status(400).json({ error: "Invalid amount" });

//   db.run(
//     `UPDATE accounts SET balance = balance + ? WHERE account_number = ?`,
//     [amount, number],
//     function (err) {
//       if (err) return res.status(500).json({ error: err.message });
//       if (this.changes === 0)
//         return res.status(404).json({ error: "Account not found" });
//       res.json({ message: "Balance updated successfully" });
//     }
//   );
// });




// 🔹 Transfer money between accounts


// app.post("/accounts/transfer", (req, res) => {
//   const { from_account, to_account, amount, description } = req.body;

//   if (!from_account || !to_account || !amount || amount <= 0) {
//     return res.status(400).json({ error: "Invalid transfer details" });
//   }

//   if (from_account === to_account) {
//     return res.status(400).json({ error: "Cannot transfer to the same account" });
//   }});

// PATCH: Add balance
// app.patch("/accounts/:number/add-balance", (req, res) => {
//   const { amount } = req.body;
//   const { number } = req.params;

//   if (!amount || amount <= 0)
//     return res.status(400).json({ error: "Invalid amount" });

//   db.run(
//     `UPDATE accounts SET balance = balance + ? WHERE account_number = ?`,
//     [amount, number],
//     function (err) {
//       if (err) return res.status(500).json({ error: err.message });
//       if (this.changes === 0)
//         return res.status(404).json({ error: "Account not found" });
//       res.json({ message: "Balance updated successfully" });
//     }
//   );
// });


app.patch("/accounts/:number/add-balance", (req, res) => {
  const { amount, description } = req.body; // optional description
  const { number } = req.params;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  // Step 1: Get previous balance
  db.get(
    `SELECT balance FROM accounts WHERE account_number = ?`,
    [number],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: "Account not found" });

      const prevBalance = row.balance || 0;
      const newBalance = prevBalance + amount;

      // Step 2: Update balance
      db.run(
        `UPDATE accounts SET balance = ? WHERE account_number = ?`,
        [newBalance, number],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          if (this.changes === 0)
            return res.status(404).json({ error: "Account not found" });

          // Step 3: Generate custom transaction_id
          const now = new Date();
          const yyyy = now.getFullYear();
          const mm = String(now.getMonth() + 1).padStart(2, "0");
          const dd = String(now.getDate()).padStart(2, "0");
          const hh = String(now.getHours()).padStart(2, "0");
          const min = String(now.getMinutes()).padStart(2, "0");
          const ss = String(now.getSeconds()).padStart(2, "0");

          const transactionId = `crd/mnl/${yyyy}-${mm}-${dd}/${hh}:${min}:${ss}`;

          // Step 4: Insert into transactions table
          db.run(
            `INSERT INTO transactions 
              (transaction_id, account_number, type, description, amount, previous_balance, updated_balance, created_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            [
              transactionId,
              number,
              "Credit",
              description || "Manual Credit",
              amount,
              prevBalance,
              newBalance,
            ],
            function (err3) {
              if (err3) {
                console.error("❌ Error inserting transaction:", err3.message);
                return res
                  .status(500)
                  .json({ error: "Balance updated but transaction failed" });
              }

              res.json({
                message:
                  "✅ Balance updated and transaction recorded successfully",
                transaction_id: transactionId,
              });
            }
          );
        }
      );
    }
  );
});


// 🔹 Transfer money between accounts
// app.post("/accounts/transfer", (req, res) => {
//   const { from_account, to_account, amount, description } = req.body;

//   if (!from_account || !to_account || !amount || amount <= 0) {
//     return res.status(400).json({ error: "Invalid transfer details" });
//   }

//   if (from_account === to_account) {
//     return res.status(400).json({ error: "Cannot transfer to the same account" });
//   }

//   db.serialize(() => {
//     // 1️⃣ Check balance of sender
//     db.get(
//       `SELECT balance FROM accounts WHERE account_number = ?`,
//       [from_account],
//       (err, sender) => {
//         if (err) return res.status(500).json({ error: err.message });
//         if (!sender) return res.status(404).json({ error: "Sender not found" });

//         if (sender.balance < amount) {
//           return res.status(400).json({ error: "Insufficient balance" });
//         }

//         // 2️⃣ Deduct from sender
//         db.run(
//           `UPDATE accounts SET balance = balance - ? WHERE account_number = ?`,
//           [amount, from_account],
//           function (err) {
//             if (err) return res.status(500).json({ error: err.message });

//             // 3️⃣ Add to receiver
//             db.run(
//               `UPDATE accounts SET balance = balance + ? WHERE account_number = ?`,
//               [amount, to_account],
//               function (err) {
//                 if (err) return res.status(500).json({ error: err.message });

//                 // 4️⃣ Record in transactions table for both
//                 const desc = description || `Transfer from ${from_account} to ${to_account}`;
//                 const now = new Date().toISOString();

//                 const stmt = db.prepare(`
//                   INSERT INTO transactions (account_number, type, description, amount, related_module, created_at)
//                   VALUES (?, ?, ?, ?, 'Transfer', ?)
//                 `);

//                 stmt.run(from_account, "Outgoing", desc, amount, now);
//                 stmt.run(to_account, "Incoming", desc, amount, now);
//                 stmt.finalize();

//                 res.json({
//                   message: "✅ Transfer successful",
//                   details: { from_account, to_account, amount },
//                 });
//               }
//             );
//           }
//         );
//       }
//     );
//   });
// });

// 🔹 Transfer money between two accounts (with transaction records)
app.post("/accounts/transfer", (req, res) => {
  const { from_account, to_account, amount, description } = req.body;

  if (!from_account || !to_account || !amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid transfer details" });
  }

  if (from_account === to_account) {
    return res.status(400).json({ error: "Cannot transfer to the same account" });
  }

  db.serialize(() => {
    db.get(
      `SELECT balance FROM accounts WHERE account_number = ?`,
      [from_account],
      (err, sender) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!sender) return res.status(404).json({ error: "Sender not found" });

        if (sender.balance < amount) {
          return res.status(400).json({ error: "Insufficient balance" });
        }

        const senderPrev = sender.balance;
        const senderNew = senderPrev - amount;

        db.run(
          `UPDATE accounts SET balance = ? WHERE account_number = ?`,
          [senderNew, from_account],
          function (err) {
            if (err) return res.status(500).json({ error: err.message });

            db.get(
              `SELECT balance FROM accounts WHERE account_number = ?`,
              [to_account],
              (err2, receiver) => {
                if (err2) return res.status(500).json({ error: err2.message });
                if (!receiver)
                  return res.status(404).json({ error: "Receiver not found" });

                const receiverPrev = receiver.balance;
                const receiverNew = receiverPrev + amount;

                db.run(
                  `UPDATE accounts SET balance = ? WHERE account_number = ?`,
                  [receiverNew, to_account],
                  function (err3) {
                    if (err3)
                      return res.status(500).json({ error: err3.message });

                    const now = new Date();
                    const yyyy = now.getFullYear();
                    const mm = String(now.getMonth() + 1).padStart(2, "0");
                    const dd = String(now.getDate()).padStart(2, "0");
                    const hh = String(now.getHours()).padStart(2, "0");
                    const min = String(now.getMinutes()).padStart(2, "0");
                    const ss = String(now.getSeconds()).padStart(2, "0");

                    const dateTime = `${yyyy}-${mm}-${dd}/${hh}:${min}:${ss}`;
                    const senderTransactionId = `deb/transf/${dateTime}`;
                    const receiverTransactionId = `crd/transf/${dateTime}`;

                    const desc =
                      description ||
                      `Transfer from ${from_account} to ${to_account}`;

                    // ✅ FIXED INSERT QUERY
                    const stmt = db.prepare(`
                      INSERT INTO transactions 
                      (transaction_id, account_number, type, description, amount, previous_balance, updated_balance, created_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
                    `);

                    stmt.run(
                      senderTransactionId,
                      from_account,
                      "Debit",
                      desc,
                      amount,
                      senderPrev,
                      senderNew
                    );
                    stmt.run(
                      receiverTransactionId,
                      to_account,
                      "Credit",
                      desc,
                      amount,
                      receiverPrev,
                      receiverNew
                    );
                    stmt.finalize();

                    res.json({
                      message: "✅ Transfer successful",
                      details: {
                        from_account,
                        to_account,
                        amount,
                        senderTransactionId,
                        receiverTransactionId,
                      },
                    });
                  }
                );
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


// this is giving month wise forecast and actuals 
// app.get("/forecast", async (req, res) => {
//   try {
//     console.log("📊 Forecast API Called");

//     const db = req.app.locals.db;
//     if (!db) throw new Error("Database not initialized");

//     const monthsAhead = parseInt(req.query.monthsAhead) || 6;
//     const monthsBack = parseInt(req.query.monthsBack) || 12;

//     const today = new Date();
//     const currentMonthKey = today.toISOString().slice(0, 7);

//     // Calculate start month for historical data
//     const startDate = new Date(today);
//     startDate.setMonth(today.getMonth() - monthsBack);
//     const startMonthKey = startDate.toISOString().slice(0, 7);

//     console.log(`📆 Forecast range: ${startMonthKey} → ${currentMonthKey} → +${monthsAhead} months`);

//     // ---------------------------------------------------
//     // 🟢 1. ACTUAL INCOME (Invoices received)
//     // ---------------------------------------------------
//     const pastIncome = await runQuery(db, `
//       SELECT 
//         strftime('%Y-%m', received_date) AS month,
//         SUM(invoice_value + gst_amount) AS total_income
//       FROM invoices
//       WHERE received = 'Yes' 
//         AND received_date IS NOT NULL
//         AND date(received_date) >= date('${startMonthKey}-01')
//       GROUP BY month
//       ORDER BY month ASC;
//     `);


// // ---------------------------------------------------
// // 🔵 2. FORECASTED INCOME (Based on Invoices + Active Projects)
// // ---------------------------------------------------

// // 1️⃣ Fetch Active Projects
// const projects = await runQuery(db, `
//   SELECT 
//     projectID,
//     startDate, 
//     endDate, 
//     netPayable, 
//     active, 
//     invoiceCycle
//   FROM Projects
//   WHERE active = 'Yes' AND netPayable IS NOT NULL;
// `);

// // 2️⃣ Fetch All Invoices (for existing + forecasted values)
// const invoiceRows = await runQuery(db, `
//   SELECT 
//     project_id,
//     strftime('%Y-%m', due_date) AS due_month,
//     invoice_value,
//     gst_amount,
//     received
//   FROM invoices
//   WHERE due_date IS NOT NULL;
// `);

// // Build income maps
// const futureIncomeMap = {};
// for (let i = -monthsBack; i < monthsAhead; i++) {
//   const m = new Date(today);
//   m.setMonth(today.getMonth() + i);
//   const key = m.toISOString().slice(0, 7);
//   futureIncomeMap[key] = 0;
// }

// // 3️⃣ Map invoices per project and month
// const invoiceMap = {};
// invoiceRows.forEach((inv) => {
//   if (!inv.project_id || !inv.due_month) return;
//   const totalValue = Number(inv.invoice_value || 0);
//   const key = `${inv.project_id}_${inv.due_month}`;
//   invoiceMap[key] = totalValue;
// });

// // 4️⃣ Compute forecasted income
// for (const p of projects) {
//   const start = p.startDate?.slice(0, 7);
//   const end = p.endDate?.slice(0, 7);
//   const monthlyBilling = Number(p.netPayable || 0);
//   if (!start) continue;

//   for (const monthKey of Object.keys(futureIncomeMap)) {
//     if (monthKey < start) continue;
//     if (end && monthKey > end) continue;

//     const invoiceKey = `${p.projectID}_${monthKey}`;
//     if (invoiceMap[invoiceKey]) {
//       // ✅ Use actual invoice value if invoice exists for this project-month
//       futureIncomeMap[monthKey] += invoiceMap[invoiceKey];
//     } else {
//       // ✅ Otherwise, use project’s forecasted netPayable (fallback)
//       if (p.invoiceCycle === "Quarterly") {
//         const [sy, sm] = start.split("-").map(Number);
//         const [y, mo] = monthKey.split("-").map(Number);
//         const diff = (y - sy) * 12 + (mo - sm);
//         if (diff % 3 !== 0) continue;
//       }
//       futureIncomeMap[monthKey] += monthlyBilling;
//     }
//   }
// }

// // 🧾 Prepare forecast output (both past + future months)
// const futureIncome = Object.entries(futureIncomeMap)
//   .filter(([m]) => m >= startMonthKey)
//   .map(([month, expected_income]) => ({
//     month,
//     expected_income,
//   }));


//     // ---------------------------------------------------
//     // 🔴 3. ACTUAL OUTGOING (Expenses + Salaries)
//     // ---------------------------------------------------
//     const pastExpenses = await runQuery(db, `
//       SELECT 
//         strftime('%Y-%m', paid_date) AS month,
//         SUM(paid_amount) AS total_expense
//       FROM expense_payments
//       WHERE paid_date IS NOT NULL
//         AND date(paid_date) >= date('${startMonthKey}-01')
//       GROUP BY month
//       ORDER BY month ASC;
//     `);

//     const salaryRows = await runQuery(db, `
//       SELECT 
//         LOWER(TRIM(employee_id)) AS employee_id,
//         strftime('%Y-%m', paid_date) AS paid_month,
//         paid_amount
//       FROM monthly_salary_payments
//       WHERE paid = 'Yes'
//         AND paid_date IS NOT NULL
//         AND date(paid_date) >= date('${startMonthKey}-01');
//     `);

//     const salaryMap = {};
//     salaryRows.forEach((row) => {
//       if (!row.paid_month) return;
//       if (!salaryMap[row.paid_month]) salaryMap[row.paid_month] = 0;
//       salaryMap[row.paid_month] += Number(row.paid_amount || 0);
//     });

//     // Merge all actuals
//     const actualOutgoingMap = {};
//     pastExpenses.forEach((r) => {
//       if (!r.month) return;
//       actualOutgoingMap[r.month] = (actualOutgoingMap[r.month] || 0) + Number(r.total_expense || 0);
//     });
//     Object.entries(salaryMap).forEach(([month, amount]) => {
//       actualOutgoingMap[month] = (actualOutgoingMap[month] || 0) + amount;
//     });

//    // ---------------------------------------------------
// // 🟣 FORECASTED OUTGOING (Expenses + Salaries)
// // ---------------------------------------------------
// // ---------------------------------------------------
// // 🟣 FORECASTED OUTGOING (Regular + One-Time Expenses + Salaries)
// // ---------------------------------------------------
// const expenses = await runQuery(db, `
//   SELECT 
//     amount,
//     raised_date,
//     regular
//   FROM expenses
//   WHERE raised_date IS NOT NULL;
// `);

// const employees = await runQuery(db, `
//   SELECT 
//     e.employee_id,
//     e.date_of_joining,
//     e.project_ending,
//     e.active,
//     sp.net_takehome
//   FROM employees e
//   LEFT JOIN salary_payments sp 
//     ON LOWER(TRIM(e.employee_id)) = LOWER(TRIM(sp.employee_id))
//   WHERE LOWER(e.active) = 'yes';
// `);

// const actualMonths = new Set(Object.keys(actualOutgoingMap));
// const futureOutgoingMap = {};

// // 🧾 Expenses Forecasting (Regular + One-Time)
// expenses.forEach((e) => {
//   if (!e.raised_date) return;
//   const start = e.raised_date.slice(0, 7);
//   const monthly = Number(e.amount || 0);
//   const isRegular = e.regular?.toLowerCase() === "yes";

//   for (let i = -monthsBack; i < monthsAhead; i++) {
//     const m = new Date(today);
//     m.setMonth(today.getMonth() + i);
//     const monthKey = m.toISOString().slice(0, 7);

//     if (monthKey < start) continue;

//     if (isRegular) {
//       // ✅ Regular: forecast every month from raised_date onwards
//       futureOutgoingMap[monthKey] =
//         (futureOutgoingMap[monthKey] || 0) + monthly;
//     } else {
//       // ✅ Non-Regular: include only in the raised month
//       if (monthKey === start) {
//         futureOutgoingMap[monthKey] =
//           (futureOutgoingMap[monthKey] || 0) + monthly;
//       }
//     }
//   }
// });

// // 👨‍💻 Salaries (forecasted from joining date)
// employees.forEach((e) => {
//   if (!e.date_of_joining) return;
//   const start = e.date_of_joining.slice(0, 7);
//   const end = e.project_ending ? e.project_ending.slice(0, 7) : null;
//   const monthly = Number(e.net_takehome || 0);

//   for (let i = -monthsBack; i < monthsAhead; i++) {
//     const m = new Date(today);
//     m.setMonth(today.getMonth() + i);
//     const monthKey = m.toISOString().slice(0, 7);

//     if (monthKey < start) continue;
//     if (end && monthKey > end) continue;

//     // ✅ Always forecast salaries after joining
//     futureOutgoingMap[monthKey] =
//       (futureOutgoingMap[monthKey] || 0) + monthly;
//   }
// });



//     // ---------------------------------------------------
//     // 🧾 Final Response
//     // ---------------------------------------------------
//     const pastExpensesArr = Object.entries(actualOutgoingMap).map(([month, amount]) => ({
//       month,
//       amount,
//     }));

//     const futureExpenses = Object.entries(futureOutgoingMap).map(([month, expected_expense]) => ({
//       month,
//       expected_expense,
//     }));

//     res.json({
//       pastIncome,
//       futureIncome,
//       pastExpenses: pastExpensesArr,
//       futureExpenses,
//     });

//     console.log("✅ Forecast Prepared Successfully:", {
//       pastIncome: pastIncome.length,
//       pastExpenses: pastExpensesArr.length,
//       futureExpenses: futureExpenses.length,
//     });
//   } catch (err) {
//     console.error("❌ Forecast API Error:", err);
//     res.status(500).json({
//       error: err.message,
//       pastIncome: [],
//       futureIncome: [],
//       pastExpenses: [],
//       futureExpenses: [],
//     });
//   }
// }); 




// -----------------------------------------------------------------------------
// 📊 FORECAST ENDPOINT — With Regular Expense Recurrence + Unpaid Salary Carry Forward
// -----------------------------------------------------------------------------
app.get("/forecast", async (req, res) => {
  try {
    console.log("📊 Forecast API Called — Enhanced Regular + Unpaid Salary Logic");

//     const db = req.app.locals.db;
//     if (!db) throw new Error("Database not initialized");

    // 🗓️ Input date range (defaults ±6 months)
    const fromDate =
      req.query.fromDate ||
      new Date(new Date().setMonth(new Date().getMonth() - 6))
        .toISOString()
        .slice(0, 10);
    const toDate =
      req.query.toDate ||
      new Date(new Date().setMonth(new Date().getMonth() + 6))
        .toISOString()
        .slice(0, 10);

    console.log(`📅 Forecast Range: ${fromDate} → ${toDate}`);

    // ---------------------------------------------------
    // 🟢 1️⃣ ACTUAL INCOME
    // ---------------------------------------------------
    const pastIncome = await runQuery(
      db,
      `
      SELECT 
        date(received_date) AS date,
        SUM(invoice_value + gst_amount) AS total_income
      FROM invoices
      WHERE received = 'Yes'
        AND received_date IS NOT NULL
        AND date(received_date) BETWEEN date(?) AND date(?)
      GROUP BY date
      ORDER BY date ASC;
    `,
      [fromDate, toDate]
    );

    // ---------------------------------------------------
    // 🔵 2️⃣ FORECASTED INCOME (due_date-based)
    // ---------------------------------------------------
    const futureIncome = await runQuery(
      db,
      `
      SELECT 
        date(due_date) AS date,
        SUM(invoice_value + gst_amount) AS expected_income
      FROM invoices
      WHERE received = 'No'
        AND due_date IS NOT NULL
        AND date(due_date) BETWEEN date(?) AND date(?)
      GROUP BY date
      ORDER BY date ASC;
    `,
      [fromDate, toDate]
    );

    // ---------------------------------------------------
    // 🔴 3️⃣ ACTUAL OUTGOINGS (Expenses + Salaries)
    // ---------------------------------------------------
    const expensePayments = await runQuery(
      db,
      `
      SELECT 
        date(paid_date) AS date,
        SUM(paid_amount) AS total_expense
      FROM expense_payments
      WHERE paid_date IS NOT NULL
        AND status = 'Paid'
        AND date(paid_date) BETWEEN date(?) AND date(?)
      GROUP BY date;
    `,
      [fromDate, toDate]
    );

    const salaryPayments = await runQuery(
      db,
      `
      SELECT 
        date(paid_date) AS date,
        SUM(paid_amount) AS total_salaries
      FROM monthly_salary_payments
      WHERE paid = 'Yes'
        AND paid_date IS NOT NULL
        AND date(paid_date) BETWEEN date(?) AND date(?)
      GROUP BY date;
    `,
      [fromDate, toDate]
    );

    const actualOutgoingMap = {};
    expensePayments.forEach((r) => {
      actualOutgoingMap[r.date] =
        (actualOutgoingMap[r.date] || 0) + Number(r.total_expense || 0);
    });
    salaryPayments.forEach((r) => {
      actualOutgoingMap[r.date] =
        (actualOutgoingMap[r.date] || 0) + Number(r.total_salaries || 0);
    });

    const pastExpenses = Object.entries(actualOutgoingMap).map(
      ([date, amount]) => ({ date, amount })
    );

 // ---------------------------------------------------
// 🟣 4. FORECASTED OUTGOINGS (Regular + Non-Regular)
// ---------------------------------------------------
const expenses = await runQuery(
  db,
  `
  SELECT 
    auto_id,
    amount,
    raised_date,
    due_date,
    regular
  FROM expenses
  WHERE raised_date IS NOT NULL
    AND due_date IS NOT NULL;
`
);

// Fetch paid expense data (for skip-paid logic)
const paidExpenseRows = await runQuery(
  db,
  `
  SELECT expense_id, paid_date
  FROM expense_payments
  WHERE status = 'Paid' AND paid_date IS NOT NULL;
`
);

// Build map: expense_id -> Set of paid_dates
const paidDatesMap = {};
paidExpenseRows.forEach((r) => {
  if (!r.expense_id || !r.paid_date) return;
  const id = Number(r.expense_id);
  const pd = r.paid_date.slice(0, 10);
  if (!paidDatesMap[id]) paidDatesMap[id] = new Set();
  paidDatesMap[id].add(pd);
});

function isPaidOnOrBefore(expenseId, targetDateStr) {
  const set = paidDatesMap[Number(expenseId)];
  if (!set) return false;
  for (const pd of set) {
    if (pd <= targetDateStr) return true;
  }
  return false;
}

const forecastOutgoingMap = {};

// ✅ <--- PUT YOUR UPDATED if(isRegular) CODE HERE
expenses.forEach((exp) => {
  if (!exp.raised_date || !exp.due_date) return;

  const expenseId = exp.auto_id;
  const raised = exp.raised_date.slice(0, 10);
  const due = exp.due_date.slice(0, 10);
  const isRegular = (exp.regular || "").toLowerCase() === "yes";
  const amount = Number(exp.amount || 0);

  if (isRegular) {
    // ✅ Repeat every month on the same due date (e.g. 5th)
    const startDate = new Date(due);
    const endDate = new Date(toDate);
    const dueDay = startDate.getDate();

    let currentMonth = startDate.getMonth();
    let currentYear = startDate.getFullYear();

    while (true) {
      const nextDue = new Date(currentYear, currentMonth, dueDay);
      const nextDueStr = nextDue.toISOString().slice(0, 10);

      // Stop if next due exceeds forecast window
      if (nextDue > endDate) break;

      // Only include dates within the range and not yet paid
      if (
        nextDueStr >= fromDate &&
        nextDueStr <= toDate &&
        !isPaidOnOrBefore(expenseId, nextDueStr)
      ) {
        forecastOutgoingMap[nextDueStr] =
          (forecastOutgoingMap[nextDueStr] || 0) + amount;
      }

      // Move to next month manually
      currentMonth++;
      if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
      }
    }
  } else {
    // 🧾 One-time expense
    if (
      due >= fromDate &&
      due <= toDate &&
      !isPaidOnOrBefore(expenseId, due)
    ) {
      forecastOutgoingMap[due] =
        (forecastOutgoingMap[due] || 0) + amount;
    }
  }
});


    // 👤 Add Unpaid Salaries to Forecasted Expenses
    const unpaidSalaries = await runQuery(
      db,
      `
      SELECT 
        employee_name,
        employee_id,
        month,
        paid_amount,
        paid
      FROM monthly_salary_payments
      WHERE paid = 'No';
    `
    );

    unpaidSalaries.forEach((sal) => {
      // Default carry-forward date = next month start
      const nextMonth = new Date(`${sal.month}-01`);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      const carryDate = nextMonth.toISOString().slice(0, 10);

      if (carryDate >= fromDate && carryDate <= toDate) {
        forecastOutgoingMap[carryDate] =
          (forecastOutgoingMap[carryDate] || 0) + Number(sal.paid_amount || 0);
      }
    });

    // Convert forecast map → array
    const futureExpenses = Object.entries(forecastOutgoingMap).map(
      ([date, expected_expense]) => ({
        date,
        expected_expense,
      })
    );

    // ---------------------------------------------------
    // ✅ FINAL RESPONSE
    // ---------------------------------------------------
    res.json({
      pastIncome,
      futureIncome,
      pastExpenses,
      futureExpenses,
    });

    console.log("✅ Forecast Ready:", {
      actualIncome: pastIncome.length,
      forecastIncome: futureIncome.length,
      actualOutgoings: pastExpenses.length,
      forecastOutgoings: futureExpenses.length,
    });
  } catch (err) {
    console.error("❌ Forecast API Error:", err);
    res.status(500).json({
      error: err.message,
      pastIncome: [],
      futureIncome: [],
      pastExpenses: [],
      futureExpenses: [],
    });
  }
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
    const netCashFlow = currentAccountBalance + inflows - outflows;

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
        netCashFlow,
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
      `✅ Forecast-only Cash Flow for ${date}: ₹${netCashFlow.toLocaleString()}`
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
app.put("/update-salary/:employee_id", (req, res) => {
  const { employee_id } = req.params;
  const { month, actual_to_pay, due_date } = req.body;

  // ✅ Input validation
  if (!employee_id || !month || !actual_to_pay || !due_date) {
    return res.status(400).json({
      error: "Employee ID, month, actual_to_pay, and due_date are required.",
    });
  }

  // Ensure month format is YYYY-MM
  const formattedMonth = month.slice(0, 7);

  // Step 1️⃣: Check if record exists
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
      // Step 2️⃣: Update existing record
      const updateQuery = `
        UPDATE monthly_salary_payments
        SET 
          actual_to_pay = ?, 
          due_date = ?, 
          paid = 'No',
          paid_amount = 0
        WHERE employee_id = ? AND month = ?
      `;

      db.run(updateQuery, [actual_to_pay, due_date, employee_id, formattedMonth], function (err) {
        if (err) {
          console.error("❌ Error updating salary:", err);
          return res.status(500).json({ error: "Failed to update salary record." });
        }

        console.log(`✅ Salary updated for ${employee_id} (${formattedMonth})`);
        res.json({
          success: true,
          message: "Salary record updated successfully.",
          data: { employee_id, month: formattedMonth, actual_to_pay, due_date, paid: "No" },
        });
      });
    } else {
      // Step 3️⃣: Insert new record
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

          console.log(`✅ New salary record created for ${employee_id} (${formattedMonth})`);
          res.json({
            success: true,
            message: "Salary record created successfully.",
            data: { employee_id, month: formattedMonth, actual_to_pay, due_date, paid: "No" },
          });
        });
      });
    }
  });
});


function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function currentDate() {
  return new Date().toISOString().slice(0, 10);
}

// ===============================
// 🗓️ DAILY FORECAST
// ===============================
app.get("/api/forecast/daily", async (req, res) => {
  try {
    const start = req.query.start || "2024-01-01";
    const end = req.query.end || "2026-12-31";

    const sql = `
      WITH days AS (
        SELECT date(?) AS d
        UNION ALL
        SELECT date(d, '+1 day')
        FROM days
        WHERE date(d, '+1 day') <= date(?)
      ),
      actual_income AS (
        SELECT date(received_date) AS day, SUM(invoice_value) AS income
        FROM invoices
        WHERE received='Yes' AND received_date IS NOT NULL
        GROUP BY day
      ),
      actual_expenses AS (
        SELECT date(paid_date) AS day, SUM(actual_amount) AS expense
        FROM expense_payments
        WHERE paid_date IS NOT NULL
        GROUP BY day
      )
      SELECT
        d.d AS day,
        COALESCE(ai.income,0) AS actual_income,
        COALESCE(ae.expense,0) AS actual_expense,
        (COALESCE(ai.income,0) - COALESCE(ae.expense,0)) AS netflow
      FROM days d
      LEFT JOIN actual_income ai ON ai.day = d.d
      LEFT JOIN actual_expenses ae ON ae.day = d.d
      ORDER BY d.d;
    `;
    const rows = await runAll(sql, [start, end]);
    res.json(rows);
  } catch (err) {
    console.error("Daily Forecast Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// 📅 WEEKLY FORECAST
// ===============================
// ===============================
// 📅 WEEKLY FORECAST
// ===============================
app.get("/api/forecast/weekly", async (req, res) => {
  try {
    const sql = `
      WITH actual_income AS (
        SELECT strftime('%Y-%W', received_date) AS week, SUM(invoice_value) AS income
        FROM invoices
        WHERE received='Yes' AND received_date IS NOT NULL
        GROUP BY week
      ),
      actual_expenses AS (
        SELECT strftime('%Y-%W', paid_date) AS week, SUM(actual_amount) AS expense
        FROM expense_payments
        WHERE paid_date IS NOT NULL
        GROUP BY week
      )
      SELECT
        ai.week AS week_key,
        COALESCE(ai.income,0) AS actual_income,
        COALESCE(ae.expense,0) AS actual_expense,
        (COALESCE(ai.income,0) - COALESCE(ae.expense,0)) AS netflow
      FROM actual_income ai
      LEFT JOIN actual_expenses ae ON ae.week = ai.week
      ORDER BY week_key;
    `;

    // ✅ no parameters needed — remove [start, end]
    const rows = await runAll(sql);
    res.json(rows);
  } catch (err) {
    console.error("Weekly Forecast Error:", err);
    res.status(500).json({ error: err.message });
  }
});


// ===============================
// 📊 MONTHLY FORECAST (Advanced)
// ===============================
// ===============================
// 📊 MONTHLY FORECAST (Enhanced with 5 metrics)
// ===============================
app.get("/api/forecast/monthly", async (req, res) => {
  try {
    const start = req.query.start || "2024-01-01";
    const end = req.query.end || "2026-12-31";

    const sql = `
    WITH RECURSIVE months(m) AS (
      SELECT strftime('%Y-%m', date(?))
      UNION ALL
      SELECT strftime('%Y-%m', date(m || '-01', '+1 month'))
      FROM months
      WHERE date(m || '-01', '+1 month') <= date(?)
    ),

    -- 🧾 Actual Income (from invoices)
    actual_income AS (
      SELECT strftime('%Y-%m', received_date) AS month, SUM(invoice_value) AS income
      FROM invoices
      WHERE received='Yes' AND received_date IS NOT NULL
      GROUP BY month
    ),

    -- 💼 Forecasted Income (from projects)
    forecasted_income AS (
      SELECT
        p.projectID,
        strftime('%Y-%m', p.startDate) AS start_m,
        strftime('%Y-%m', p.endDate) AS end_m,
        p.netPayable,
        ((CAST(strftime('%Y', p.endDate) AS INTEGER) - CAST(strftime('%Y', p.startDate) AS INTEGER))*12 +
         (CAST(strftime('%m', p.endDate) AS INTEGER) - CAST(strftime('%m', p.startDate) AS INTEGER)) + 1) AS total_months
      FROM Projects p
      WHERE p.active='Yes'
    ),

    forecast_income_by_month AS (
      SELECT
        m.m AS month,
        SUM(
          CASE
            WHEN date(m.m || '-01') BETWEEN date(fi.start_m || '-01') AND date(fi.end_m || '-01')
            THEN fi.netPayable / fi.total_months
            ELSE 0
          END
        ) AS income
      FROM months m
      CROSS JOIN forecasted_income fi
      GROUP BY m.m
    ),

    -- 🧾 Actual Expense (salary + expense_payments)
    actual_salary AS (
      SELECT month, SUM(actual_to_pay) AS salary FROM monthly_salary_payments GROUP BY month
    ),
    actual_other_expense AS (
      SELECT month_year AS month, SUM(actual_amount) AS other_expense FROM expense_payments GROUP BY month_year
    ),
    actual_expense AS (
      SELECT
        m.m AS month,
        COALESCE(s.salary,0) + COALESCE(o.other_expense,0) AS expense
      FROM months m
      LEFT JOIN actual_salary s ON s.month = m.m
      LEFT JOIN actual_other_expense o ON o.month = m.m
    ),

    -- 🔮 Forecasted Expense (future months)
    recurring_expense AS (
      SELECT COALESCE(SUM(amount),0) AS recurring FROM expenses WHERE regular='Yes'
    ),

    forecasted_expense AS (
      SELECT
        m.m AS month,
        CASE WHEN m.m > strftime('%Y-%m','now')
          THEN (SELECT recurring FROM recurring_expense)
          ELSE 0
        END AS expense
      FROM months m
    )

    SELECT
      m.m AS month,
      COALESCE(ai.income,0) AS actual_income,
      COALESCE(fim.income,0) AS forecasted_income,
      COALESCE(ae.expense,0) AS actual_expense,
      COALESCE(fe.expense,0) AS forecasted_expense,
      (COALESCE(ai.income,0) - COALESCE(ae.expense,0)) AS actual_netflow,
      (COALESCE(fim.income,0) - COALESCE(fe.expense,0)) AS forecasted_netflow
    FROM months m
    LEFT JOIN actual_income ai ON ai.month = m.m
    LEFT JOIN forecast_income_by_month fim ON fim.month = m.m
    LEFT JOIN actual_expense ae ON ae.month = m.m
    LEFT JOIN forecasted_expense fe ON fe.month = m.m
    ORDER BY m.m;
    `;

    const rows = await runAll(sql, [start, end]);
    res.json(rows);
  } catch (err) {
    console.error("Forecast Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// 📆 YEARLY FORECAST
// ===============================
app.get("/api/forecast/yearly", async (req, res) => {
  try {
    const sql = `
      WITH actual_income AS (
        SELECT strftime('%Y', received_date) AS year, SUM(invoice_value) AS income
        FROM invoices
        WHERE received='Yes' AND received_date IS NOT NULL
        GROUP BY year
      ),
      actual_expenses AS (
        SELECT strftime('%Y', paid_date) AS year, SUM(actual_amount) AS expense
        FROM expense_payments
        WHERE paid_date IS NOT NULL
        GROUP BY year
      )
      SELECT
        ai.year,
        COALESCE(ai.income,0) AS actual_income,
        COALESCE(ae.expense,0) AS actual_expense,
        (COALESCE(ai.income,0) - COALESCE(ae.expense,0)) AS netflow
      FROM actual_income ai
      LEFT JOIN actual_expenses ae ON ae.year = ai.year
      ORDER BY ai.year;
    `;
    const rows = await runAll(sql);
    res.json(rows);
  } catch (err) {
    console.error("Yearly Forecast Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// 📈 FORECAST SUMMARY (Totals)
app.get("/api/forecast/summary", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // ✅ Validate
    if (!startDate || !endDate) {
      return res.status(400).json({ error: "startDate and endDate are required" });
    }

    const sql = `
      SELECT
        -- 🟢 Actual income: invoices received within the selected period
        (SELECT SUM(invoice_value)
         FROM invoices
         WHERE received='Yes'
         AND invoice_date BETWEEN ? AND ?) AS total_actual_income,

        -- 🔵 Forecasted income: active projects overlapping the selected period
        (SELECT SUM(netPayable)
         FROM Projects
         WHERE active='Yes'
         AND (
            (start_date BETWEEN ? AND ?)
            OR (end_date BETWEEN ? AND ?)
            OR (? BETWEEN start_date AND end_date)
         )) AS total_forecast_income,

        -- 🔴 Actual expenses: salaries + expense payments during selected period
        (
          (SELECT SUM(actual_to_pay)
           FROM monthly_salary_payments
           WHERE payment_date BETWEEN ? AND ?)
          +
          (SELECT SUM(actual_amount)
           FROM expense_payments
           WHERE payment_date BETWEEN ? AND ?)
        ) AS total_actual_expense,

        -- 🟡 Recurring expenses (ongoing regular ones)
        (SELECT SUM(amount)
         FROM expenses
         WHERE regular='Yes') AS recurring_expense;
    `;

    const params = [
      startDate, endDate, // invoices
      startDate, endDate, startDate, endDate, startDate, // projects
      startDate, endDate, // salary payments
      startDate, endDate  // expense payments
    ];

    const [row] = await runAll(sql, params);

    row.netflow =
      (row.total_actual_income || 0) -
      ((row.total_actual_expense || 0) + (row.recurring_expense || 0));

    res.json(row);
  } catch (err) {
    console.error("Summary Forecast Error:", err);
    res.status(500).json({ error: err.message });
  }
});







app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});