#include <iostream>
#include <fstream>
#include <string>
#include <cmath>
#include <iomanip>
#include <sstream>

using namespace std;  

const int MAX_PRODUCTS = 150; 
const int MAX_CART_ITEMS = 100;

struct Product {
    string id;
    string name;
    double price;
    int stock; 
};

struct CartItem {
    Product product;
    int quantity;
};

// Forward declaration so login functions know admin_mainMenu exists
void admin_mainMenu();

void view_sales_history() {
    cout << "\n=============== View Sales History ===============" << endl; 
    ifstream inHistory("sales_history.txt");
    
    if (!inHistory.is_open()) {
        cout << "No sales history found. No sales have been made yet." << endl;
    } else {
        string line;
        while (getline(inHistory, line)) {
            cout << line << endl;
        }
        inHistory.close();
    }
    cout << "==================================================" << endl;
    admin_mainMenu(); // Return to admin menu
}

void view_daily_summary() {
    cout << "\n=============== View Daily Summary ===============" << endl; 
    ifstream inHistory("sales_history.txt");
    
    if (!inHistory.is_open()) {
        cout << "No sales data available to summarize." << endl;
    } else {
        string line;
        double total_revenue_usd = 0.0;
        int total_transactions = 0;

        // Read the file and look for the lines where we saved "TOTAL_USD:"
        while (getline(inHistory, line)) {
            if (line.find("TOTAL_USD:") != string::npos) {
                // Extract the number part after "TOTAL_USD:"
                string amount_str = line.substr(10); 
                total_revenue_usd += stod(amount_str);
                total_transactions++;
            }
        }
        inHistory.close();

        cout << "Total Transactions Today: " << total_transactions << endl;
        cout << "Total Revenue (USD): $" << fixed << setprecision(2) << total_revenue_usd << endl;
        cout << "Total Revenue (KHR): " << (total_revenue_usd * 4000) << " KHR" << endl;
    }
    cout << "==================================================" << endl;
    admin_mainMenu(); // Return to admin menu
}

void managing_product() {
    cout << "\n=============== Managing Product ===============" << endl; 
    
    // 1. Load the current inventory first
    Product inventory[MAX_PRODUCTS];
    int inventoryCount = 0; 
    ifstream inProductFile("product.txt");
    
    if (inProductFile.is_open()) {
        string line;
        while (getline(inProductFile, line) && inventoryCount < MAX_PRODUCTS) {
            if (line.empty()) continue;
            stringstream ss(line);
            string id, name, price_str, stock_str;

            getline(ss, id, ',');
            getline(ss, name, ',');
            getline(ss, price_str, ','); 
            getline(ss, stock_str);
            
            inventory[inventoryCount].id = id;
            inventory[inventoryCount].name = name;
            inventory[inventoryCount].price = stod(price_str);
            inventory[inventoryCount].stock = stoi(stock_str); 
            inventoryCount++;
        }
        inProductFile.close();
    } else {
        cout << "Warning: Could not open product.txt. Starting with empty inventory." << endl;
    }

    // 2. Sub-menu for managing products
    cout << "1. View all products" << endl;
    cout << "2. Add a new product" << endl;
    cout << "3. Update existing product stock/price" << endl;
    cout << "4. Return to Admin Menu" << endl;
    cout << "Choose an option: ";
    
    int choice;
    cin >> choice;

    if (choice == 1) {
        cout << "\n--- Current Inventory ---" << endl;
        for (int i = 0; i < inventoryCount; i++) {
            cout << inventory[i].id << " | " << left << setw(20) << inventory[i].name 
                 << " | $" << fixed << setprecision(2) << inventory[i].price 
                 << " | Stock: " << inventory[i].stock << endl;
        }
    } 
    else if (choice == 2) {
        if (inventoryCount >= MAX_PRODUCTS) {
            cout << "Inventory is full! Cannot add more products." << endl;
        } else {
            cout << "Enter Product ID: ";
            cin >> inventory[inventoryCount].id;
            cout << "Enter Product Name (no spaces, use underscores): ";
            cin >> inventory[inventoryCount].name;
            cout << "Enter Price (USD): ";
            cin >> inventory[inventoryCount].price;
            cout << "Enter Initial Stock: ";
            cin >> inventory[inventoryCount].stock;
            
            inventoryCount++;
            cout << "Product added successfully!" << endl;
        }
    } 
    else if (choice == 3) {
        string search_id;
        cout << "Enter Product ID to update: ";
        cin >> search_id;
        
        bool found = false;
        for (int i = 0; i < inventoryCount; i++) {
            if (inventory[i].id == search_id) {
                found = true;
                cout << "Updating: " << inventory[i].name << endl;
                cout << "Enter new price (or enter same price to keep it): ";
                cin >> inventory[i].price;
                cout << "Enter new stock amount: ";
                cin >> inventory[i].stock;
                cout << "Product updated successfully!" << endl;
                break;
            }
        }
        if (!found) cout << "Product ID not found." << endl;
    } 
    else if (choice == 4) {
        admin_mainMenu();
        return;
    }

    // 3. Save changes back to file if they added or updated something
    if (choice == 2 || choice == 3) {
        ofstream outProductFile("product.txt");
        for (int i = 0; i < inventoryCount; i++) {
            outProductFile << inventory[i].id << "," << inventory[i].name << ","
                           << inventory[i].price << "," << inventory[i].stock << endl;
        }
        outProductFile.close();
    }
    
    managing_product(); // Loop back to product menu
}

void admin_mainMenu() {
    cout << "\n=============== ADMIN Main Menu ===============" << endl; 
    cout << "Choose Option (1-4)" << endl;
    cout << "1. View Sales History" << endl; 
    cout << "2. View Daily Summary" << endl; 
    cout << "3. Manage Products" << endl;
    cout << "4. Logout" << endl;
    
    int choice_admin_mainMenu; 
    cout << "Enter your option: ";
    cin >> choice_admin_mainMenu;

    switch (choice_admin_mainMenu) {
        case 1: 
            view_sales_history();  // Fixed typo here
            break;
        case 2: 
            view_daily_summary();
            break;
        case 3:
            managing_product();
            break;
        case 4:
            cout << "Logging out..." << endl;
            return; // Goes back to main login screen
        default:
            cout << "Invalid Input! \n" << endl;
            admin_mainMenu();  
    }
}

// ==========================================
// CASHIER FUNCTIONS
// ==========================================

void cashier_mainMenu() {
    ifstream inProductFile("product.txt");
    if (!inProductFile.is_open()) {
        cout << "Error: Could not open product.txt" << endl;
        return;
    }

    Product inventory[MAX_PRODUCTS];
    int inventoryCount = 0; 
    string line;

    while (getline(inProductFile, line) && inventoryCount < MAX_PRODUCTS) {
        if (line.empty()) continue;
        
        stringstream ss(line);
        string id, name, price_str, stock_str;

        getline(ss, id, ',');
        getline(ss, name, ',');
        getline(ss, price_str, ','); 
        getline(ss, stock_str);
        
        inventory[inventoryCount].id = id;
        inventory[inventoryCount].name = name;
        inventory[inventoryCount].price = stod(price_str);
        inventory[inventoryCount].stock = stoi(stock_str); 
        inventoryCount++;
    }
    inProductFile.close();

    CartItem cart[MAX_CART_ITEMS];
    int cartCount = 0; 
    string input_id;
    
    cout << "\n=============== CASHIER Main Menu ===============" << endl;
    cout << "Enter a Product ID to add to cart (or type '0' to finish)." << endl;

    while (true) {
        cout << "\nEnter Product ID: ";
        cin >> input_id;

        if (input_id == "0") {
            break; 
        }

        if (cartCount >= MAX_CART_ITEMS) {
            cout << "Cart limit reached! Cannot add more items." << endl;
            break;
        }

        bool found = false;
        for (int i = 0; i < inventoryCount; i++) {
            if (inventory[i].id == input_id) {
                found = true;
                int quantity;
                
                cout << "Product found: " << inventory[i].name << " ($" << inventory[i].price << ")" << endl;
                cout << "Current Stock: " << inventory[i].stock << " units" << endl;
                cout << "Enter quantity to buy: ";
                cin >> quantity;

                if (quantity > inventory[i].stock) {
                    cout << "Error: Not enough stock! You requested " << quantity 
                         << ", but only " << inventory[i].stock << " are available." << endl;
                } else if (quantity <= 0) {
                    cout << "Error: Please enter a valid quantity greater than 0." << endl;
                } else {
                    cart[cartCount].product = inventory[i];
                    cart[cartCount].quantity = quantity;
                    cartCount++;
                    
                    inventory[i].stock -= quantity;
                    
                    cout << "-> Added " << quantity << "x " << inventory[i].name << " to cart." << endl;
                }
                break; 
            }
        }
        if (!found) {
            cout << "Error: Product ID '" << input_id << "' not found. Try again." << endl;
        }
    }

    if (cartCount == 0) {
        cout << "Cart is empty. Exiting cashier menu." << endl;
        return;
    }

    cout << "\n================= RECEIPT =================" << endl;
    double grand_total = 0.0;
    int grand_total_riels; 

    for (int i = 0; i < cartCount; i++) {
        double subtotal = cart[i].product.price * cart[i].quantity;
        grand_total += subtotal;
        grand_total_riels = grand_total * 4000; 

        cout << left << setw(20) << cart[i].product.name 
             << " x" << left << setw(4) << cart[i].quantity 
             << "$" << right << setw(8) << fixed << setprecision(2) << subtotal << endl;
    }
    
    cout << "-------------------------------------------" << endl;
    cout << left << setw(26) << "TOTAL DUE:" 
         << "$" << right << setw(8) << fixed << setprecision(2) << grand_total << endl;
    cout << left << setw(26) << "TOTAL DUE KHR:" 
         << "KHR" << right << setw(8) << grand_total_riels << endl;
    cout << "===========================================" << endl;

    int usd_khr;
    double cash_usd;
    int cash_khr;
    double cashBack_usd;
    int cashBack_khr;

    while (true) {
        cout << "Enter The Given Type of Money (1:USD or 2:KHR): ";
        cin >> usd_khr;
        
        if (usd_khr == 1){
            cout << "Enter The Given Money (USD): ";
            cin >> cash_usd;
            cashBack_usd = cash_usd - grand_total;
            cashBack_khr = cashBack_usd * 4000;
            cout << left << setw(26) << "CHANGE (USD):" 
                 << "$" << right << setw(8) << fixed << setprecision(2) << cashBack_usd << endl;
            cout << left << setw(26) << "CHANGE (KHR):" 
                 << "KHR" << right << setw(8) << cashBack_khr << endl;
            break;
        }
        else if (usd_khr == 2){
            cout << "Enter The Given Money (KHR): ";
            cin >> cash_khr;
            cashBack_khr = cash_khr - grand_total_riels;
            cashBack_usd = (double)cashBack_khr / 4000.0;
            cout << left << setw(26) << "CHANGE (KHR):" 
                 << "KHR" << right << setw(8) << cashBack_khr << endl;
            cout << left << setw(26) << "CHANGE (USD):" 
                 << "$" << right << setw(8) << fixed << setprecision(2) << cashBack_usd << endl;
            break;
        } 
        else {
            cout << "Invalid Input! Please try again.\n";
        }
    }
    cout << "===========================================" << endl;

    // --- NEW LOGIC: UPDATE INVENTORY ---
    ofstream outProductFile("product.txt");
    if (outProductFile.is_open()) {
        for (int i = 0; i < inventoryCount; i++) {
            outProductFile << inventory[i].id << "," << inventory[i].name << ","
                           << inventory[i].price << "," << inventory[i].stock << endl;
        }
        outProductFile.close();
    }

    // --- NEW LOGIC: RECORD SALE IN HISTORY FOR ADMIN ---
    ofstream outHistory("sales_history.txt", ios::app); // ios::app ensures we don't erase past sales
    if (outHistory.is_open()) {
        outHistory << "--- NEW SALE ---" << endl;
        for (int i = 0; i < cartCount; i++) {
            outHistory << cart[i].quantity << "x " << cart[i].product.name << endl;
        }
        // Save this exact line format so the summary function can read it easily
        outHistory << "TOTAL_USD:" << grand_total << endl; 
        outHistory << "----------------" << endl;
        outHistory.close();
    }
}

// ==========================================
// LOGIN & MAIN FUNCTIONS
// ==========================================

void login_admin(){
    string admin_username;
    string admin_username_txt; 
    string admin_password;      // Changed to string to prevent crash on non-number input
    string admin_password_txt; 
    char seperator; 

    ifstream inAdminFile ("admin_login.txt");

    if (!inAdminFile.is_open()){
        cout << "Error: admin_login.txt not found!" << endl;
        return;
    }

    inAdminFile >> admin_username_txt >> seperator >> admin_password_txt;
    cout << "\n=============== Login ADMIN ===============" << endl; 
    
    do { 
        cout << "Enter your ADMIN username: "; 
        cin >> admin_username;
        if (admin_username != admin_username_txt) {
            cout << "Incorrect username. Try again." << endl;
        }
    } while (admin_username != admin_username_txt);
    
    do {
        cout << "Enter your ADMIN password: ";
        cin >> admin_password; 
        if (admin_password != admin_password_txt) {
            cout << "Incorrect password. Try again." << endl;
        } else {
            admin_mainMenu();
        }
    } while (admin_password != admin_password_txt);
}

void login_cashier(){
    string cashier_username;
    string cashier_username_txt; 
    string cashier_password;   // Changed to string
    string cashier_password_txt; 
    char seperator; 

    ifstream inCashierFile ("cashier_login.txt");

    if (!inCashierFile.is_open()){
        cout << "Error: cashier_login.txt not found!" << endl;
        return;
    }

    inCashierFile >> cashier_username_txt >> seperator >> cashier_password_txt;
    cout << "\n=============== Login CASHIER ===============" << endl; 
    
    do { 
        cout << "Enter your CASHIER username: "; 
        cin >> cashier_username;
        if (cashier_username != cashier_username_txt) {
            cout << "Incorrect username. Try again." << endl;
        }
    } while (cashier_username != cashier_username_txt);
    
    do {
        cout << "Enter your CASHIER password: ";
        cin >> cashier_password; 
        if (cashier_password != cashier_password_txt) {
            cout << "Incorrect password. Try again." << endl;
        } else {
            cashier_mainMenu();
        }
    } while (cashier_password != cashier_password_txt);
}

void admin_cashier_mainMenu(){
    int choice_admin_or_cashier;

    while(true) {
        cout << "\n=============== Welcome to SMART! ===============" << endl; 
        cout << "Enter (1) to login as ADMIN" << endl; 
        cout << "Enter (2) to login as CASHIER" << endl; 
        cout << "Enter (0) to Exit System" << endl;
        cout << "Enter your number here: "; 
        cin >> choice_admin_or_cashier;

        switch (choice_admin_or_cashier){
            case 1:
                login_admin();
                break;
            case 2: 
                login_cashier();
                break; 
            case 0:
                cout << "Exiting system. Goodbye!" << endl;
                return;
            default: 
                cout << "Invalid Input! Please Enter the correct Number!" << endl;
        }
    }
}

int main(){
    admin_cashier_mainMenu();
    return 0; 
}