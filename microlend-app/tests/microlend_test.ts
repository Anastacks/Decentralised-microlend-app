import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v0.14.0/index.ts';
import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';

// Test constants matching contract constants
const ERR_NOT_AUTHORIZED = 1000;
const ERR_INVALID_AMOUNT = 1001;
const ERR_INSUFFICIENT_COLLATERAL = 1002;
const ERR_LOAN_NOT_FOUND = 1003;
const ERR_LOAN_ALREADY_ACTIVE = 1004;
const ERR_LOAN_NOT_ACTIVE = 1005;
const ERR_LOAN_NOT_DEFAULTED = 1006;
const ERR_INVALID_LIQUIDATION = 1007;
const ERR_INVALID_REPAYMENT = 1008;
const ERR_INVALID_DURATION = 1009;
const ERR_INVALID_INTEREST_RATE = 1010;
const ERR_EMERGENCY_STOP = 1011;
const ERR_PRICE_FEED_FAILURE = 1012;
const ERR_INVALID_COLLATERAL_ASSET = 1013;

const MIN_COLLATERAL_RATIO = 200; // 200%
const MAX_INTEREST_RATE = 5000; // 50%
const MIN_DURATION = 1440; // 1 day in blocks
const MAX_DURATION = 525600; // 1 year in blocks

// Helper function to setup basic collateral asset and price
function setupBasicAsset(chain: Chain, deployer: Account, asset: string = "BTC", price: number = 50000)
{
    return chain.mineBlock([
        Tx.contractCall('microlend', 'add-collateral-asset', [types.ascii(asset)], deployer.address),
        Tx.contractCall('microlend', 'update-asset-price', [types.ascii(asset), types.uint(price)], deployer.address)
    ]);
}

Clarinet.test({
    name: "Ensure that contract owner can be set and retrieved correctly",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const wallet1 = accounts.get('wallet_1')!;

        // Check initial owner
        let result = chain.callReadOnlyFn('microlend', 'get-contract-owner', [], deployer.address);
        assertEquals(result.result, deployer.address);

        // Set new owner
        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'set-contract-owner', [types.principal(wallet1.address)], deployer.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectBool(true);

        // Verify new owner
        result = chain.callReadOnlyFn('microlend', 'get-contract-owner', [], deployer.address);
        assertEquals(result.result, wallet1.address);
    },
});

Clarinet.test({
    name: "Ensure that non-owner cannot set contract owner",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const wallet1 = accounts.get('wallet_1')!;
        const wallet2 = accounts.get('wallet_2')!;

        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'set-contract-owner', [types.principal(wallet2.address)], wallet1.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_NOT_AUTHORIZED);
    },
});

Clarinet.test({
    name: "Ensure that emergency stop mechanism works correctly",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const wallet1 = accounts.get('wallet_1')!;

        // Check initial state (should be false)
        let result = chain.callReadOnlyFn('microlend', 'get-contract-status', [], deployer.address);
        result.result.expectBool(false);

        // Toggle emergency stop
        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'toggle-emergency-stop', [], deployer.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectBool(true);

        // Verify emergency stop is active
        result = chain.callReadOnlyFn('microlend', 'get-contract-status', [], deployer.address);
        result.result.expectBool(true);

        // Non-owner cannot toggle
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'toggle-emergency-stop', [], wallet1.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_NOT_AUTHORIZED);
    },
});

Clarinet.test({
    name: "Ensure that collateral assets can be added and removed correctly",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const wallet1 = accounts.get('wallet_1')!;

        // Add collateral asset
        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'add-collateral-asset', [types.ascii("BTC")], deployer.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectBool(true);

        // Remove collateral asset
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'remove-collateral-asset', [types.ascii("BTC")], deployer.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectBool(true);

        // Non-owner cannot add asset
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'add-collateral-asset', [types.ascii("ETH")], wallet1.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_NOT_AUTHORIZED);
    },
});

Clarinet.test({
    name: "Ensure that asset prices can be updated with proper validation",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const wallet1 = accounts.get('wallet_1')!;

        // First add the asset
        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'add-collateral-asset', [types.ascii("BTC")], deployer.address)
        ]);

        // Update asset price
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'update-asset-price', [types.ascii("BTC"), types.uint(50000)], deployer.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectBool(true);

        // Try to update price for non-existent asset
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'update-asset-price', [types.ascii("ETH"), types.uint(3000)], deployer.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_INVALID_COLLATERAL_ASSET);

        // Non-owner cannot update price
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'update-asset-price', [types.ascii("BTC"), types.uint(51000)], wallet1.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_NOT_AUTHORIZED);

        // Invalid price (zero)
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'update-asset-price', [types.ascii("BTC"), types.uint(0)], deployer.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_INVALID_AMOUNT);
    },
});

Clarinet.test({
    name: "Ensure that loan requests can be created with valid parameters",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const borrower = accounts.get('wallet_1')!;

        // Setup asset
        setupBasicAsset(chain, deployer);

        // Create valid loan request
        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000), // amount
                types.uint(3000), // collateral (300% ratio)
                types.ascii("BTC"), // collateral asset
                types.uint(7200), // duration (5 days)
                types.uint(1000) // interest rate (10%)
            ], borrower.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);

        // Verify loan was created
        let result = chain.callReadOnlyFn('microlend', 'get-loan', [types.uint(1)], borrower.address);
        const loan = result.result.expectSome().expectTuple();
        assertEquals(loan['borrower'], borrower.address);
        assertEquals(loan['amount'], types.uint(1000));
        assertEquals(loan['status'], types.ascii("PENDING"));
    },
});

Clarinet.test({
    name: "Ensure that loan requests fail with insufficient collateral",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const borrower = accounts.get('wallet_1')!;

        // Setup asset
        setupBasicAsset(chain, deployer);

        // Create loan request with insufficient collateral (150% < 200% minimum)
        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000), // amount
                types.uint(1500), // collateral (150% ratio)
                types.ascii("BTC"), // collateral asset
                types.uint(7200), // duration
                types.uint(1000) // interest rate
            ], borrower.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_INSUFFICIENT_COLLATERAL);
    },
});

Clarinet.test({
    name: "Ensure that loan requests fail with invalid parameters",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const borrower = accounts.get('wallet_1')!;

        // Setup asset
        setupBasicAsset(chain, deployer);

        // Invalid amount (zero)
        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(0),
                types.uint(3000),
                types.ascii("BTC"),
                types.uint(7200),
                types.uint(1000)
            ], borrower.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_INVALID_AMOUNT);

        // Invalid duration (too short)
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000),
                types.uint(3000),
                types.ascii("BTC"),
                types.uint(100), // Less than MIN_DURATION
                types.uint(1000)
            ], borrower.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_INVALID_DURATION);

        // Invalid interest rate (too high)
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000),
                types.uint(3000),
                types.ascii("BTC"),
                types.uint(7200),
                types.uint(6000) // Greater than MAX_INTEREST_RATE (5000)
            ], borrower.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_INVALID_INTEREST_RATE);

        // Invalid collateral asset
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000),
                types.uint(3000),
                types.ascii("INVALID"), // Asset not added
                types.uint(7200),
                types.uint(1000)
            ], borrower.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_INVALID_COLLATERAL_ASSET);
    },
});

Clarinet.test({
    name: "Ensure that loans cannot be created when emergency stop is active",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const borrower = accounts.get('wallet_1')!;

        // Setup asset
        setupBasicAsset(chain, deployer);

        // Activate emergency stop
        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'toggle-emergency-stop', [], deployer.address)
        ]);

        // Try to create loan request
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000),
                types.uint(3000),
                types.ascii("BTC"),
                types.uint(7200),
                types.uint(1000)
            ], borrower.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_EMERGENCY_STOP);
    },
});

Clarinet.test({
    name: "Ensure that loans can be activated by owner",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const borrower = accounts.get('wallet_1')!;

        // Setup asset and create loan
        setupBasicAsset(chain, deployer);

        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000),
                types.uint(3000),
                types.ascii("BTC"),
                types.uint(7200),
                types.uint(1000)
            ], borrower.address)
        ]);

        // Activate loan
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'activate-loan', [types.uint(1)], deployer.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectBool(true);

        // Verify loan status changed to ACTIVE
        let result = chain.callReadOnlyFn('microlend', 'get-loan', [types.uint(1)], deployer.address);
        const loan = result.result.expectSome().expectTuple();
        assertEquals(loan['status'], types.ascii("ACTIVE"));
    },
});

Clarinet.test({
    name: "Ensure that non-owner cannot activate loans",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const borrower = accounts.get('wallet_1')!;
        const wallet2 = accounts.get('wallet_2')!;

        // Setup asset and create loan
        setupBasicAsset(chain, deployer);

        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000),
                types.uint(3000),
                types.ascii("BTC"),
                types.uint(7200),
                types.uint(1000)
            ], borrower.address)
        ]);

        // Try to activate loan as non-owner
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'activate-loan', [types.uint(1)], wallet2.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_NOT_AUTHORIZED);
    },
});

Clarinet.test({
    name: "Ensure that loans cannot be activated twice",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const borrower = accounts.get('wallet_1')!;

        // Setup asset and create loan
        setupBasicAsset(chain, deployer);

        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000),
                types.uint(3000),
                types.ascii("BTC"),
                types.uint(7200),
                types.uint(1000)
            ], borrower.address)
        ]);

        // Activate loan first time
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'activate-loan', [types.uint(1)], deployer.address)
        ]);
        block.receipts[0].result.expectOk().expectBool(true);

        // Try to activate again
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'activate-loan', [types.uint(1)], deployer.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_LOAN_ALREADY_ACTIVE);
    },
});

Clarinet.test({
    name: "Ensure that non-existent loans cannot be activated",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;

        // Try to activate non-existent loan
        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'activate-loan', [types.uint(999)], deployer.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_LOAN_NOT_FOUND);
    },
});

Clarinet.test({
    name: "Ensure that loans can be liquidated when conditions are met",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const borrower = accounts.get('wallet_1')!;
        const liquidator = accounts.get('wallet_2')!;

        // Setup asset and create loan
        setupBasicAsset(chain, deployer);

        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000),
                types.uint(3000),
                types.ascii("BTC"),
                types.uint(100), // Very short duration for testing
                types.uint(1000)
            ], borrower.address)
        ]);

        // Activate loan
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'activate-loan', [types.uint(1)], deployer.address)
        ]);

        // Mine blocks to exceed duration
        for (let i = 0; i < 15; i++)
        {
            chain.mineEmptyBlock();
        }

        // Liquidate loan
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'liquidate-loan', [types.uint(1)], liquidator.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectBool(true);

        // Verify loan status changed to LIQUIDATED
        let result = chain.callReadOnlyFn('microlend', 'get-loan', [types.uint(1)], deployer.address);
        const loan = result.result.expectSome().expectTuple();
        assertEquals(loan['status'], types.ascii("LIQUIDATED"));
    },
});

Clarinet.test({
    name: "Ensure that loans cannot be liquidated prematurely",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const borrower = accounts.get('wallet_1')!;
        const liquidator = accounts.get('wallet_2')!;

        // Setup asset and create loan
        setupBasicAsset(chain, deployer);

        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000),
                types.uint(3000),
                types.ascii("BTC"),
                types.uint(7200), // Long duration
                types.uint(1000)
            ], borrower.address)
        ]);

        // Activate loan
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'activate-loan', [types.uint(1)], deployer.address)
        ]);

        // Try to liquidate immediately
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'liquidate-loan', [types.uint(1)], liquidator.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_LOAN_NOT_DEFAULTED);
    },
});

Clarinet.test({
    name: "Ensure that non-active loans cannot be liquidated",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const borrower = accounts.get('wallet_1')!;
        const liquidator = accounts.get('wallet_2')!;

        // Setup asset and create loan (but don't activate)
        setupBasicAsset(chain, deployer);

        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000),
                types.uint(3000),
                types.ascii("BTC"),
                types.uint(7200),
                types.uint(1000)
            ], borrower.address)
        ]);

        // Try to liquidate pending loan
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'liquidate-loan', [types.uint(1)], liquidator.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_LOAN_NOT_ACTIVE);
    },
});

Clarinet.test({
    name: "Ensure that liquidation is blocked during emergency stop",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const borrower = accounts.get('wallet_1')!;
        const liquidator = accounts.get('wallet_2')!;

        // Setup asset and create loan
        setupBasicAsset(chain, deployer);

        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000),
                types.uint(3000),
                types.ascii("BTC"),
                types.uint(100), // Short duration
                types.uint(1000)
            ], borrower.address)
        ]);

        // Activate loan
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'activate-loan', [types.uint(1)], deployer.address)
        ]);

        // Wait for duration to pass
        for (let i = 0; i < 15; i++)
        {
            chain.mineEmptyBlock();
        }

        // Activate emergency stop
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'toggle-emergency-stop', [], deployer.address)
        ]);

        // Try to liquidate during emergency stop
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'liquidate-loan', [types.uint(1)], liquidator.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_EMERGENCY_STOP);
    },
});

Clarinet.test({
    name: "Ensure that total due calculation works correctly",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const borrower = accounts.get('wallet_1')!;

        // Setup asset and create loan
        setupBasicAsset(chain, deployer);

        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000), // amount
                types.uint(3000), // collateral
                types.ascii("BTC"),
                types.uint(7200),
                types.uint(1000) // 10% interest rate
            ], borrower.address)
        ]);

        // Calculate total due (should be 1000 + 100 = 1100)
        let result = chain.callReadOnlyFn('microlend', 'calculate-total-due', [types.uint(1)], deployer.address);
        result.result.expectOk().expectUint(1100);

        // Test with non-existent loan
        result = chain.callReadOnlyFn('microlend', 'calculate-total-due', [types.uint(999)], deployer.address);
        result.result.expectErr().expectUint(ERR_LOAN_NOT_FOUND);
    },
});

Clarinet.test({
    name: "Ensure that user reputation is tracked correctly",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const borrower = accounts.get('wallet_1')!;

        // Setup asset and create loan
        setupBasicAsset(chain, deployer);

        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000),
                types.uint(3000),
                types.ascii("BTC"),
                types.uint(100), // Short duration for liquidation
                types.uint(1000)
            ], borrower.address)
        ]);

        // Activate and then liquidate loan to trigger reputation update
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'activate-loan', [types.uint(1)], deployer.address)
        ]);

        // Wait for duration to pass
        for (let i = 0; i < 15; i++)
        {
            chain.mineEmptyBlock();
        }

        // Liquidate loan
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'liquidate-loan', [types.uint(1)], borrower.address)
        ]);

        // Check reputation (should show a default)
        let result = chain.callReadOnlyFn('microlend', 'get-user-reputation', [types.principal(borrower.address)], deployer.address);
        const reputation = result.result.expectSome().expectTuple();
        assertEquals(reputation['defaults'], types.uint(1));
    },
});

Clarinet.test({
    name: "Ensure that multiple loans can be created and managed independently",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const borrower1 = accounts.get('wallet_1')!;
        const borrower2 = accounts.get('wallet_2')!;

        // Setup asset
        setupBasicAsset(chain, deployer);

        // Create two loans
        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000),
                types.uint(3000),
                types.ascii("BTC"),
                types.uint(7200),
                types.uint(1000)
            ], borrower1.address),
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(2000),
                types.uint(5000),
                types.ascii("BTC"),
                types.uint(14400),
                types.uint(1500)
            ], borrower2.address)
        ]);
        assertEquals(block.receipts.length, 2);
        block.receipts[0].result.expectOk().expectUint(1);
        block.receipts[1].result.expectOk().expectUint(2);

        // Activate first loan only
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'activate-loan', [types.uint(1)], deployer.address)
        ]);

        // Check loan states
        let result1 = chain.callReadOnlyFn('microlend', 'get-loan', [types.uint(1)], deployer.address);
        let result2 = chain.callReadOnlyFn('microlend', 'get-loan', [types.uint(2)], deployer.address);

        const loan1 = result1.result.expectSome().expectTuple();
        const loan2 = result2.result.expectSome().expectTuple();

        assertEquals(loan1['status'], types.ascii("ACTIVE"));
        assertEquals(loan2['status'], types.ascii("PENDING"));
        assertEquals(loan1['borrower'], borrower1.address);
        assertEquals(loan2['borrower'], borrower2.address);
    },
});

Clarinet.test({
    name: "Ensure that price feed failures are handled correctly",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const borrower = accounts.get('wallet_1')!;

        // Add asset but don't set price
        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'add-collateral-asset', [types.ascii("BTC")], deployer.address)
        ]);

        // Try to create loan without price feed
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000),
                types.uint(3000),
                types.ascii("BTC"),
                types.uint(7200),
                types.uint(1000)
            ], borrower.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_PRICE_FEED_FAILURE);
    },
});

Clarinet.test({
    name: "Ensure that edge case validations work correctly",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const borrower = accounts.get('wallet_1')!;

        // Setup asset
        setupBasicAsset(chain, deployer);

        // Test exact minimum collateral ratio (200%)
        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000),
                types.uint(2000), // Exactly 200% ratio
                types.ascii("BTC"),
                types.uint(MIN_DURATION), // Minimum duration
                types.uint(MAX_INTEREST_RATE) // Maximum interest rate
            ], borrower.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);

        // Test maximum duration
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000),
                types.uint(3000),
                types.ascii("BTC"),
                types.uint(MAX_DURATION), // Maximum duration
                types.uint(1000)
            ], borrower.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(2);

        // Test duration too long
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000),
                types.uint(3000),
                types.ascii("BTC"),
                types.uint(MAX_DURATION + 1), // Exceeds maximum
                types.uint(1000)
            ], borrower.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_INVALID_DURATION);
    },
});

Clarinet.test({
    name: "Ensure that collateral asset management handles empty strings correctly",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;

        // Try to add empty asset name
        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'add-collateral-asset', [types.ascii("")], deployer.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_INVALID_AMOUNT);

        // Try to update price for empty asset name
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'update-asset-price', [types.ascii(""), types.uint(1000)], deployer.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_INVALID_AMOUNT);
    },
});

Clarinet.test({
    name: "Ensure that loan ID bounds are properly validated",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;

        // Try to activate loan with ID 0
        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'activate-loan', [types.uint(0)], deployer.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_LOAN_NOT_FOUND);

        // Try to liquidate loan with ID 0
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'liquidate-loan', [types.uint(0)], deployer.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_LOAN_NOT_FOUND);

        // Try to get loan with ID 0
        let result = chain.callReadOnlyFn('microlend', 'get-loan', [types.uint(0)], deployer.address);
        result.result.expectNone();
    },
});

Clarinet.test({
    name: "Ensure that contract state persists correctly across blocks",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const borrower = accounts.get('wallet_1')!;

        // Setup asset
        setupBasicAsset(chain, deployer);

        // Create loan
        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000),
                types.uint(3000),
                types.ascii("BTC"),
                types.uint(7200),
                types.uint(1000)
            ], borrower.address)
        ]);

        // Mine several empty blocks
        for (let i = 0; i < 10; i++)
        {
            chain.mineEmptyBlock();
        }

        // Verify loan still exists and data is intact
        let result = chain.callReadOnlyFn('microlend', 'get-loan', [types.uint(1)], deployer.address);
        const loan = result.result.expectSome().expectTuple();
        assertEquals(loan['amount'], types.uint(1000));
        assertEquals(loan['collateral-amount'], types.uint(3000));
        assertEquals(loan['status'], types.ascii("PENDING"));

        // Activate loan
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'activate-loan', [types.uint(1)], deployer.address)
        ]);

        // Mine more blocks
        for (let i = 0; i < 5; i++)
        {
            chain.mineEmptyBlock();
        }

        // Verify activation persisted
        result = chain.callReadOnlyFn('microlend', 'get-loan', [types.uint(1)], deployer.address);
        const activeLoan = result.result.expectSome().expectTuple();
        assertEquals(activeLoan['status'], types.ascii("ACTIVE"));
    },
});

Clarinet.test({
    name: "Ensure that multiple asset types can be managed simultaneously",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const borrower = accounts.get('wallet_1')!;

        // Add multiple assets
        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'add-collateral-asset', [types.ascii("BTC")], deployer.address),
            Tx.contractCall('microlend', 'add-collateral-asset', [types.ascii("ETH")], deployer.address),
            Tx.contractCall('microlend', 'add-collateral-asset', [types.ascii("USDT")], deployer.address)
        ]);
        assertEquals(block.receipts.length, 3);

        // Set prices for all assets
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'update-asset-price', [types.ascii("BTC"), types.uint(50000)], deployer.address),
            Tx.contractCall('microlend', 'update-asset-price', [types.ascii("ETH"), types.uint(3000)], deployer.address),
            Tx.contractCall('microlend', 'update-asset-price', [types.ascii("USDT"), types.uint(1)], deployer.address)
        ]);
        assertEquals(block.receipts.length, 3);

        // Create loans with different collateral assets
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000),
                types.uint(3000),
                types.ascii("BTC"),
                types.uint(7200),
                types.uint(1000)
            ], borrower.address),
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(500),
                types.uint(1500),
                types.ascii("ETH"),
                types.uint(7200),
                types.uint(1200)
            ], borrower.address),
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(100),
                types.uint(300),
                types.ascii("USDT"),
                types.uint(7200),
                types.uint(800)
            ], borrower.address)
        ]);
        assertEquals(block.receipts.length, 3);
        block.receipts[0].result.expectOk().expectUint(1);
        block.receipts[1].result.expectOk().expectUint(2);
        block.receipts[2].result.expectOk().expectUint(3);

        // Verify all loans were created with correct collateral assets
        let result1 = chain.callReadOnlyFn('microlend', 'get-loan', [types.uint(1)], deployer.address);
        let result2 = chain.callReadOnlyFn('microlend', 'get-loan', [types.uint(2)], deployer.address);
        let result3 = chain.callReadOnlyFn('microlend', 'get-loan', [types.uint(3)], deployer.address);

        const loan1 = result1.result.expectSome().expectTuple();
        const loan2 = result2.result.expectSome().expectTuple();
        const loan3 = result3.result.expectSome().expectTuple();

        assertEquals(loan1['collateral-asset'], types.ascii("BTC"));
        assertEquals(loan2['collateral-asset'], types.ascii("ETH"));
        assertEquals(loan3['collateral-asset'], types.ascii("USDT"));
    },
});

Clarinet.test({
    name: "Ensure that contract owner changes affect authorization correctly",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const newOwner = accounts.get('wallet_1')!;
        const borrower = accounts.get('wallet_2')!;

        // Setup initial asset as deployer
        setupBasicAsset(chain, deployer);

        // Change owner
        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'set-contract-owner', [types.principal(newOwner.address)], deployer.address)
        ]);

        // Old owner should not be able to add assets
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'add-collateral-asset', [types.ascii("ETH")], deployer.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_NOT_AUTHORIZED);

        // New owner should be able to add assets
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'add-collateral-asset', [types.ascii("ETH")], newOwner.address),
            Tx.contractCall('microlend', 'update-asset-price', [types.ascii("ETH"), types.uint(3000)], newOwner.address)
        ]);
        assertEquals(block.receipts.length, 2);
        block.receipts[0].result.expectOk().expectBool(true);
        block.receipts[1].result.expectOk().expectBool(true);

        // Create loan to test activation authorization
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(1000),
                types.uint(3000),
                types.ascii("ETH"),
                types.uint(7200),
                types.uint(1000)
            ], borrower.address)
        ]);

        // Old owner cannot activate
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'activate-loan', [types.uint(1)], deployer.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectErr().expectUint(ERR_NOT_AUTHORIZED);

        // New owner can activate
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'activate-loan', [types.uint(1)], newOwner.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectBool(true);
    },
});

Clarinet.test({
    name: "Ensure that comprehensive loan lifecycle works end-to-end",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const borrower = accounts.get('wallet_1')!;
        const liquidator = accounts.get('wallet_2')!;

        // Complete setup
        setupBasicAsset(chain, deployer, "BTC", 50000);

        // 1. Create loan request
        let block = chain.mineBlock([
            Tx.contractCall('microlend', 'create-loan-request', [
                types.uint(10000), // Borrow $10,000
                types.uint(25000), // Collateral $25,000 (250% ratio)
                types.ascii("BTC"),
                types.uint(2880), // 2 days duration
                types.uint(1500) // 15% interest rate
            ], borrower.address)
        ]);
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);

        // 2. Verify loan is in PENDING state
        let result = chain.callReadOnlyFn('microlend', 'get-loan', [types.uint(1)], deployer.address);
        let loan = result.result.expectSome().expectTuple();
        assertEquals(loan['status'], types.ascii("PENDING"));
        assertEquals(loan['borrower'], borrower.address);

        // 3. Calculate expected total due
        result = chain.callReadOnlyFn('microlend', 'calculate-total-due', [types.uint(1)], deployer.address);
        result.result.expectOk().expectUint(11500); // 10000 + 1500 (15% interest)

        // 4. Activate loan
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'activate-loan', [types.uint(1)], deployer.address)
        ]);
        block.receipts[0].result.expectOk().expectBool(true);

        // 5. Verify loan is now ACTIVE
        result = chain.callReadOnlyFn('microlend', 'get-loan', [types.uint(1)], deployer.address);
        loan = result.result.expectSome().expectTuple();
        assertEquals(loan['status'], types.ascii("ACTIVE"));

        // 6. Wait for loan to expire
        for (let i = 0; i < 50; i++)
        {
            chain.mineEmptyBlock();
        }

        // 7. Liquidate expired loan
        block = chain.mineBlock([
            Tx.contractCall('microlend', 'liquidate-loan', [types.uint(1)], liquidator.address)
        ]);
        block.receipts[0].result.expectOk().expectBool(true);

        // 8. Verify loan is LIQUIDATED
        result = chain.callReadOnlyFn('microlend', 'get-loan', [types.uint(1)], deployer.address);
        loan = result.result.expectSome().expectTuple();
        assertEquals(loan['status'], types.ascii("LIQUIDATED"));

        // 9. Verify borrower reputation was affected
        result = chain.callReadOnlyFn('microlend', 'get-user-reputation', [types.principal(borrower.address)], deployer.address);
        const reputation = result.result.expectSome().expectTuple();
        assertEquals(reputation['defaults'], types.uint(1));
        assertEquals(reputation['successful-repayments'], types.uint(0));
    },
});